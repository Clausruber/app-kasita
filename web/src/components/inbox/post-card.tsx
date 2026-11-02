"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ExternalLink, MessageSquare, ThumbsUp } from "lucide-react";
import type { AccountDoc, Post } from "@/lib/types";
import { platformColor, platformName } from "@/lib/platforms";
import { cn } from "@/lib/utils";

export function postImage(post: Post) {
  return post.picture ?? post.mediaItems?.find((m) => m.type !== "video")?.url ?? null;
}

function postAccount(post: Post, accounts: AccountDoc[]) {
  const accountId = post.platforms?.[0]?.accountId;
  return accounts.find((a) => a.id === accountId);
}

function PlatformDot({ platform, className }: { platform: string; className?: string }) {
  return (
    <span
      title={platformName(platform)}
      className={cn("flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-background", className)}
      style={{ background: platformColor(platform) }}
    >
      {platformName(platform).charAt(0)}
    </span>
  );
}

function Stats({ post }: { post: Post }) {
  const comments = Math.max(post.commentCount ?? 0, post.platformCommentCount ?? 0);
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
        <MessageSquare className="size-3.5" />
        {comments} {comments === 1 ? "comentario" : "comentarios"}
        {post.unreadCount > 0 && (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{post.unreadCount}</span>
        )}
      </span>
      <span className="flex items-center gap-1">
        <ThumbsUp className="size-3.5" />
        {post.likeCount ?? 0}
      </span>
    </div>
  );
}

/** Compact card for the posts column. */
export function PostCard({
  post,
  accounts,
  selected,
  onClick,
}: {
  post: Post;
  accounts: AccountDoc[];
  selected?: boolean;
  onClick?: () => void;
}) {
  const platform = post.platforms?.[0]?.platform ?? "";
  const account = postAccount(post, accounts);
  const img = postImage(post) ?? account?.picture ?? null;
  const username = post.accountUsername ?? account?.username;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full space-y-2 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/40",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex gap-3">
        <div className="relative shrink-0">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="size-14 rounded-lg object-cover" />
          ) : (
            <div className="size-14 rounded-lg bg-muted" />
          )}
          <PlatformDot platform={platform} className="absolute -right-1 -bottom-1" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold">{username ? `@${username}` : platformName(platform)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {format(post.scheduledFor.toDate(), "d MMM", { locale: es })}
            </span>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{post.content || "(sin texto)"}</p>
        </div>
      </div>
      <Stats post={post} />
    </button>
  );
}
