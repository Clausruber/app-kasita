"use client";

import { useEffect, useState } from "react";
import { doc, increment, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";
import { EyeOff, Eye, Reply } from "lucide-react";
import { db, functions } from "@/lib/firebase/client";
import { postDoc } from "@/lib/firebase/paths";
import { useWorkspaceUid } from "@/hooks/use-me";
import { usePostMessages } from "@/hooks/use-firestore";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const replyFn = httpsCallable<{ postId: string; messageId?: string; text: string; requestId: string }>(
  functions,
  "alReplyToComment",
);
const hideFn = httpsCallable<{ postId: string; messageId: string; hidden: boolean }>(functions, "alHideComment");

function when(m: Message) {
  return m.createdAt?.toDate().toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) ?? "ahora";
}

/** Live comment thread of a post, with reply/hide. Marks incoming comments as read when shown. */
export function CommentThread({ postId }: { postId: string }) {
  const ws = useWorkspaceUid();
  const { data: messages, loading } = usePostMessages(postId);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!ws) return;
    const unread = messages.filter((m) => m.direction === "in" && !m.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((m) => batch.update(doc(db, m.path), { read: true }));
    batch.update(doc(db, postDoc(ws, postId)), { unreadCount: increment(-unread.length) });
    batch.commit().catch(() => {});
  }, [messages, postId, ws]);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await replyFn({ postId, messageId: replyTo?.id, text, requestId: crypto.randomUUID() });
      setText("");
      setReplyTo(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function toggleHidden(m: Message) {
    try {
      await hideFn({ postId, messageId: m.id, hidden: !m.hidden });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const byId = new Map(messages.map((m) => [m.commentId, m]));

  return (
    <div className="space-y-3">
      {loading && <p className="text-sm text-muted-foreground">Cargando comentarios…</p>}
      {!loading && !messages.length && <p className="text-sm text-muted-foreground">Sin comentarios todavía.</p>}
      <ul className="space-y-2">
        {messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              "rounded-lg border p-2.5 text-sm",
              m.direction === "out" && "ml-6 bg-primary/5",
              m.parentId && byId.has(m.parentId) && m.direction === "in" && "ml-6",
              m.hidden && "opacity-50",
            )}
          >
            <div className="flex items-center gap-2">
              {m.author.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.author.picture} alt="" className="size-5 rounded-full" />
              ) : null}
              <span className="font-medium">{m.author.name || m.author.username || "Usuario"}</span>
              <span className="text-xs text-muted-foreground">{when(m)}</span>
              {m.direction === "in" && (
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" size="icon-xs" aria-label="Responder" onClick={() => setReplyTo(m)}>
                    <Reply />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={m.hidden ? "Mostrar" : "Ocultar"}
                    onClick={() => toggleHidden(m)}
                  >
                    {m.hidden ? <Eye /> : <EyeOff />}
                  </Button>
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap">{m.text}</p>
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t pt-3">
        {replyTo && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Respondiendo a {replyTo.author.name || replyTo.author.username}
            <button className="underline" onClick={() => setReplyTo(null)}>
              cancelar
            </button>
          </p>
        )}
        <Textarea
          rows={2}
          placeholder={replyTo ? "Escribe tu respuesta…" : "Comentar en el post…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        <Button size="sm" disabled={sending || !text.trim()} onClick={send}>
          {sending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </div>
  );
}
