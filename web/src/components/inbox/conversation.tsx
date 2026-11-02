"use client";

import { useEffect, useMemo, useRef } from "react";
import { doc, increment, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { Bot, Eye, EyeOff } from "lucide-react";
import { db, functions } from "@/lib/firebase/client";
import { postDoc } from "@/lib/firebase/paths";
import { useWorkspaceUid, useCan } from "@/hooks/use-me";
import type { Message, Post } from "@/lib/types";
import { Avatar, type Commenter } from "@/components/inbox/commenter-list";
import { BookingChip, Composer, type SendInput } from "@/components/inbox/composer";
import { cn } from "@/lib/utils";

const replyFn = httpsCallable<{ postId: string; messageId: string; requestId: string } & SendInput>(
  functions,
  "dfReplyToComment",
);
const hideFn = httpsCallable<{ postId: string; messageId: string; hidden: boolean }>(functions, "dfHideComment");
const suggestFn = httpsCallable<{ postId: string; messageId: string; note?: string }, { reply: string }>(
  functions,
  "dfSuggestReply",
);

/** The selected user's thread (oldest first) + reply composer. The post is shown in column 1. */
export function Conversation({
  post,
  messages,
  commenter,
}: {
  post: Post;
  messages: Message[];
  commenter: Commenter;
}) {
  const ws = useWorkspaceUid();
  const bottom = useRef<HTMLDivElement>(null);
  const platform = commenter.latest.platform;
  const canReply = useCan()("inbox.reply");

  // This user's comments plus our replies to them, first one on top.
  const thread = useMemo(
    () =>
      messages
        .filter((m) =>
          m.direction === "in"
            ? (m.author.username || m.author.name || "?") === commenter.key
            : m.parentId != null && commenter.commentIds.has(m.parentId),
        )
        // Pending server timestamps (just sent) sort last.
        .sort((a, b) => (a.createdAt?.toMillis() ?? Infinity) - (b.createdAt?.toMillis() ?? Infinity)),
    [messages, commenter],
  );

  // Mark this user's comments as read when the conversation is open.
  useEffect(() => {
    if (!ws) return;
    const unread = thread.filter((m) => m.direction === "in" && !m.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((m) => batch.update(doc(db, m.path), { read: true }));
    batch.update(doc(db, postDoc(ws, post.id)), { unreadCount: increment(-unread.length) });
    batch.commit().catch(() => {});
  }, [thread, post.id, ws]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread.length]);

  async function toggleHidden(m: Message) {
    try {
      await hideFn({ postId: post.id, messageId: m.id, hidden: !m.hidden });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">

        <ul className="space-y-3">
          {thread.map((m) => {
            const mine = m.direction === "out";
            return (
              <li key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                {!mine && <Avatar name={commenter.name} picture={commenter.picture} className="size-8" />}
                <div className={cn("group max-w-[80%] space-y-1", mine && "items-end text-right")}>
                  <div
                    className={cn(
                      "rounded-2xl px-3 py-2 text-left text-sm whitespace-pre-wrap",
                      mine ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted",
                      m.hidden && "opacity-50",
                    )}
                  >
                    {!mine && <p className="text-xs font-semibold">{commenter.name}</p>}
                    {m.text}
                    {m.attachmentUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.attachmentUrl} alt="Anexo" className="mt-2 max-h-48 rounded-lg" />
                    )}
                  </div>
                  <div className={cn("flex items-center gap-2 px-1 text-[11px] text-muted-foreground", mine && "justify-end")}>
                    {mine && m.booking && <BookingChip booking={m.booking} />}
                    {mine && m.sentBy === "ai" && (
                      <span className="flex items-center gap-0.5 rounded bg-violet-500/15 px-1 text-violet-700 dark:text-violet-300">
                        <Bot className="size-3" /> IA
                      </span>
                    )}
                    <span>{m.createdAt ? format(m.createdAt.toDate(), "d MMM, HH:mm", { locale: es }) : "enviando…"}</span>
                    {m.hidden && <span>· oculto</span>}
                    {!mine && canReply && (
                      <button
                        className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        onClick={() => toggleHidden(m)}
                        aria-label={m.hidden ? "Mostrar comentario" : "Ocultar comentario"}
                      >
                        {m.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div ref={bottom} />
      </div>

      <Composer
        latest={commenter.latest}
        placeholder={`Responder a ${commenter.name}…`}
        canAttach={platform === "facebook"}
        attachHint="Los anexos solo están disponibles en Facebook"
        onSuggest={async (note) => (await suggestFn({ postId: post.id, messageId: commenter.latest.id, note })).data.reply}
        onSend={async (input) => {
          await replyFn({ postId: post.id, messageId: commenter.latest.id, requestId: crypto.randomUUID(), ...input });
        }}
      />
    </div>
  );
}
