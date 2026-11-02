"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Sparkles } from "lucide-react";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Commenter = {
  key: string;
  name: string;
  picture: string | null;
  lastText: string;
  lastAt: Date | null;
  unread: number;
  commentIds: Set<string>;
  latest: Message; // most recent incoming comment, the one we reply to
};

/** Groups a post's incoming comments by author. Most recent activity first. */
export function groupCommenters(messages: Message[]): Commenter[] {
  const map = new Map<string, Commenter>();
  for (const m of messages) {
    if (m.direction !== "in") continue;
    const key = m.author.username || m.author.name || "?";
    const at = m.createdAt?.toDate() ?? null;
    const c = map.get(key);
    if (!c) {
      map.set(key, {
        key,
        name: m.author.name || m.author.username || "Usuario",
        picture: m.author.picture,
        lastText: m.text,
        lastAt: at,
        unread: m.read ? 0 : 1,
        commentIds: new Set(m.commentId ? [m.commentId] : []),
        latest: m,
      });
      continue;
    }
    if (m.commentId) c.commentIds.add(m.commentId);
    if (!m.read) c.unread++;
    c.picture ||= m.author.picture;
    if (at && (!c.lastAt || at > c.lastAt)) Object.assign(c, { lastAt: at, lastText: m.text, latest: m });
  }
  return [...map.values()].sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
}

export function Avatar({ name, picture, className }: { name: string; picture: string | null; className?: string }) {
  return picture ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={picture} alt="" className={cn("size-9 shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium", className)}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function CommenterList({
  commenters,
  selectedKey,
  onSelect,
  loading,
}: {
  commenters: Commenter[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  loading: boolean;
}) {
  if (loading) return <p className="p-3 text-sm text-muted-foreground">Cargando…</p>;
  if (!commenters.length) return <p className="p-3 text-sm text-muted-foreground">Este post no tiene comentarios.</p>;
  return (
    <ul className="space-y-1">
      {commenters.map((c) => (
        <li key={c.key}>
          <button
            onClick={() => onSelect(c.key)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-muted/60",
              selectedKey === c.key && "bg-muted",
            )}
          >
            <Avatar name={c.name} picture={c.picture} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.name}</span>
                {c.lastAt && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDistanceToNow(c.lastAt, { locale: es })}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{c.lastText}</p>
            </div>
            {c.latest.aiDraft?.text && !c.latest.replied && (
              <Sparkles
                className={cn("size-3.5 shrink-0", c.latest.aiDraft.needsHuman ? "text-amber-500" : "text-violet-500")}
                aria-label="Borrador de IA pendiente"
              />
            )}
            {c.unread > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{c.unread}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
