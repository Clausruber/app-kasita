"use client";

import { useEffect, useMemo, useRef } from "react";
import { doc, increment, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Bot, Sparkles } from "lucide-react";
import { db, functions } from "@/lib/firebase/client";
import { conversationsCol } from "@/lib/firebase/paths";
import { useWorkspaceUid } from "@/hooks/use-me";
import type { Conversation, Message } from "@/lib/types";
import { Avatar } from "@/components/inbox/commenter-list";
import { BookingChip, Composer, type SendInput } from "@/components/inbox/composer";
import { cn } from "@/lib/utils";

const replyFn = httpsCallable<{ conversationId: string; messageId?: string; requestId: string } & SendInput>(functions, "alReplyToDm");
const suggestFn = httpsCallable<{ conversationId: string; messageId: string; note?: string }, { reply: string }>(functions, "alSuggestReply");

const nameOf = (c: Conversation) => c.participant?.name || "Usuario";

/** Column 1 in "Mensajes" mode: DM conversations, most recent first. */
export function DmList({
  conversations,
  selectedId,
  onSelect,
  loading,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) return <p className="p-2 text-sm text-muted-foreground">Cargando…</p>;
  if (!conversations.length) return <p className="p-2 text-sm text-muted-foreground">Aún no hay mensajes directos.</p>;
  return (
    <ul className="space-y-1">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => onSelect(c.id)}
            className={cn("flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-muted", c.id === selectedId && "bg-muted")}
          >
            <Avatar name={nameOf(c)} picture={c.participant?.picture ?? null} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-sm font-medium">{nameOf(c)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {c.lastMessageAt ? formatDistanceToNow(c.lastMessageAt.toDate(), { locale: es, addSuffix: false }) : ""}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span className="truncate text-xs text-muted-foreground">
                  {c.platform} · {c.lastMessage}
                </span>
                {!!c.unreadCount && <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{c.unreadCount}</span>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Column 3 in "Mensajes" mode: the DM thread + the same composer as comments (no attachments). */
export function DmThread({ conversation, messages }: { conversation: Conversation; messages: Message[] }) {
  const ws = useWorkspaceUid();
  const bottom = useRef<HTMLDivElement>(null);
  const name = nameOf(conversation);
  const sorted = useMemo(
    () => [...messages].sort((a, b) => (a.createdAt?.toMillis() ?? Infinity) - (b.createdAt?.toMillis() ?? Infinity)),
    [messages],
  );
  const latest = [...sorted].reverse().find((m) => m.direction === "in") ?? null;

  useEffect(() => {
    if (!ws) return;
    const unread = sorted.filter((m) => m.direction === "in" && !m.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((m) => batch.update(doc(db, m.path), { read: true }));
    batch.update(doc(db, `${conversationsCol(ws)}/${conversation.id}`), { unreadCount: increment(-unread.length) });
    batch.commit().catch(() => {});
  }, [sorted, conversation.id, ws]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [sorted.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {sorted.map((m) => {
          const mine = m.direction === "out";
          return (
            <li key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
              {!mine && <Avatar name={name} picture={conversation.participant?.picture ?? null} className="size-8" />}
              <div className={cn("max-w-[80%] space-y-1", mine && "text-right")}>
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-left text-sm whitespace-pre-wrap",
                    mine ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted",
                  )}
                >
                  {m.text}
                </div>
                <div className={cn("flex items-center gap-2 px-1 text-[11px] text-muted-foreground", mine && "justify-end")}>
                  {mine && m.booking && <BookingChip booking={m.booking} />}
                  {mine && m.sentBy === "ai" && (
                    <span className="flex items-center gap-0.5 rounded bg-violet-500/15 px-1 text-violet-700 dark:text-violet-300">
                      <Bot className="size-3" /> IA
                    </span>
                  )}
                  {!mine && m.aiDraft?.text && !m.replied && <Sparkles className="size-3 text-violet-500" aria-label="Borrador IA" />}
                  <span>{m.createdAt ? format(m.createdAt.toDate(), "d MMM, HH:mm", { locale: es }) : "enviando…"}</span>
                </div>
              </div>
            </li>
          );
        })}
        <div ref={bottom} />
      </ul>
      {latest ? (
        <Composer
          latest={latest}
          placeholder={`Responder a ${name}…`}
          canAttach={false}
          attachHint="Los anexos no están disponibles en mensajes directos"
          onSuggest={async (note) => (await suggestFn({ conversationId: conversation.id, messageId: latest.id, note })).data.reply}
          onSend={async ({ text, booking, saveClient }) => {
            await replyFn({ conversationId: conversation.id, messageId: latest.id, requestId: crypto.randomUUID(), text, booking, saveClient });
          }}
        />
      ) : (
        <p className="border-t p-3 text-sm text-muted-foreground">Esperando un mensaje de {name}.</p>
      )}
    </div>
  );
}
