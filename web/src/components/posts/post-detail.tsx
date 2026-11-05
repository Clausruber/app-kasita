"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ExternalLink, MessageCircle, Trash2, X } from "lucide-react";
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

/** Side panel or embedded view with a post's details: edit/reschedule while pending, comments once published. */
export function PostDetail({
  post,
  onClose,
  embedded = false,
}: {
  post: Post;
  onClose?: () => void;
  embedded?: boolean;
}) {
  const can = useCan();
  // Editing a scheduled post needs "posts.create"; otherwise it is shown read-only.
  const editable = post.source === "app" && EDITABLE.has(post.status) && can("posts.create");
  const [content, setContent] = useState(post.content);
  const [when, setWhen] = useState(format(post.scheduledFor.toDate(), "yyyy-MM-dd'T'HH:mm"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setContent(post.content);
    setWhen(format(post.scheduledFor.toDate(), "yyyy-MM-dd'T'HH:mm"));
  }, [post.id, post.content, post.scheduledFor]);

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
      onClose?.();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const contentSection = (
    <div className="flex-1 min-h-0 space-y-5 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {post.platforms.map((t) => (
          <span key={`${t.platform}-${t.accountId}`} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
            <PlatformBadge platform={t.platform} />
            {t.url && (
              <a href={t.url} target="_blank" rel="noreferrer" aria-label="Ver publicación" className="hover:text-primary">
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </a>
            )}
            {t.error && <span className="text-xs text-destructive">{t.error}</span>}
          </span>
        ))}
      </div>

      {post.mediaItems?.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {post.mediaItems.map((m) =>
            m.type === "video" ? (
              <video key={m.url} src={m.url} className="h-44 max-w-sm rounded-xl border bg-black object-contain shadow-xs" controls />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.url} src={m.url} alt="" className="h-44 max-w-sm rounded-xl border object-cover shadow-xs" />
            ),
          )}
        </div>
      ) : post.picture ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.picture} alt="" className="h-44 max-w-sm rounded-xl border object-cover shadow-xs" />
        </div>
      ) : null}

      {editable ? (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <Label htmlFor="post-content" className="text-xs font-medium">Contenido del post</Label>
          <Textarea id="post-content" rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="space-y-1.5">
            <Label htmlFor="when" className="text-xs font-medium">Fecha y hora de publicación</Label>
            <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-1">
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
        <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.content || "(Publicación sin texto)"}</p>
          <p className="text-xs text-muted-foreground">
            {post.scheduledFor.toDate().toLocaleString("es", { dateStyle: "full", timeStyle: "short" })}
          </p>
        </div>
      )}

      {!editable && (
        <section className="space-y-3 pt-2">
          <div className="flex items-center gap-2 border-b pb-2">
            <MessageCircle className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Comentarios ({post.commentCount ?? 0})</h3>
          </div>
          <CommentThread postId={post.id} />
          {can("posts.delete") && (
            <div className="pt-2">
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={remove}>
                <Trash2 /> Quitar del calendario
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col rounded-2xl border bg-card text-card-foreground shadow-xs overflow-hidden">
        <header className="flex items-center gap-2 border-b px-4 py-3 bg-muted/30">
          <StatusBadge status={post.status} />
          {post.source === "external" && <span className="text-xs text-muted-foreground">Publicado fuera de la app</span>}
          <span className="ml-auto text-xs text-muted-foreground">
            {post.scheduledFor.toDate().toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })}
          </span>
          {onClose && (
            <Button variant="ghost" size="icon" className="md:hidden ml-2" aria-label="Cerrar" onClick={onClose}>
              <X />
            </Button>
          )}
        </header>
        {contentSection}
      </div>
    );
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-xl">
      <header className="flex items-center gap-2 border-b p-3">
        <StatusBadge status={post.status} />
        {post.source === "external" && <span className="text-xs text-muted-foreground">Publicado fuera de la app</span>}
        {onClose && (
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="Cerrar" onClick={onClose}>
            <X />
          </Button>
        )}
      </header>
      {contentSection}
    </aside>
  );
}
