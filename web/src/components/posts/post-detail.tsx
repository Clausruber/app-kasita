"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ExternalLink, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Post } from "@/lib/types";
import { CommentThread } from "@/components/inbox/comment-thread";
import { PlatformBadge } from "@/components/shared/platform-badge";
import { StatusBadge } from "@/components/posts/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-me";

const EDITABLE = new Set(["scheduled", "draft", "failed"]);

/** Side panel with a post's details: edit/reschedule while pending, comments once published. */
export function PostDetail({ post, onClose }: { post: Post; onClose: () => void }) {
  const can = useCan();
  // Editing a scheduled post needs "posts.create"; otherwise it is shown read-only.
  const editable = post.source === "app" && EDITABLE.has(post.status) && can("posts.create");
  const [content, setContent] = useState(post.content);
  const [when, setWhen] = useState(format(post.scheduledFor.toDate(), "yyyy-MM-dd'T'HH:mm"));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/posts/${post.id}`, {
        method: "PUT",
        body: { content, scheduledFor: new Date(when).toISOString() },
      });
      toast.success("Post actualizado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(editable ? "¿Cancelar y borrar este post?" : "¿Quitar este post del calendario?")) return;
    setBusy(true);
    try {
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      toast.success("Post eliminado");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-xl">
      <header className="flex items-center gap-2 border-b p-3">
        <StatusBadge status={post.status} />
        {post.source === "external" && <span className="text-xs text-muted-foreground">Publicado fuera de la app</span>}
        <Button variant="ghost" size="icon" className="ml-auto" aria-label="Cerrar" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-3">
          {post.platforms.map((t) => (
            <span key={`${t.platform}-${t.accountId}`} className="flex items-center gap-1">
              <PlatformBadge platform={t.platform} />
              {t.url && (
                <a href={t.url} target="_blank" rel="noreferrer" aria-label="Ver publicación">
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </a>
              )}
              {t.error && <span className="text-xs text-destructive">{t.error}</span>}
            </span>
          ))}
        </div>

        {post.mediaItems?.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {post.mediaItems.map((m) =>
              m.type === "video" ? (
                <video key={m.url} src={m.url} className="h-28 rounded-lg" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={m.url} src={m.url} alt="" className="h-28 rounded-lg object-cover" />
              ),
            )}
          </div>
        )}

        {editable ? (
          <div className="space-y-3">
            <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="space-y-1.5">
              <Label htmlFor="when">Fecha y hora</Label>
              <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={save}>
                Guardar cambios
              </Button>
              {can("posts.delete") && (
                <Button size="sm" variant="destructive" disabled={busy} onClick={remove}>
                  <Trash2 /> Cancelar post
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap">{post.content}</p>
            <p className="text-xs text-muted-foreground">
              {post.scheduledFor.toDate().toLocaleString("es", { dateStyle: "full", timeStyle: "short" })}
            </p>
          </>
        )}

        {!editable && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Comentarios ({post.commentCount ?? 0})</h3>
            <CommentThread postId={post.id} />
            {can("posts.delete") && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={remove}>
                <Trash2 /> Quitar del calendario
              </Button>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
