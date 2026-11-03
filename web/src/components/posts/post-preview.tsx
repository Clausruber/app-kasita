"use client";

import { useState } from "react";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Repeat2, Send, Share, ThumbsUp } from "lucide-react";
import { platformName } from "@/lib/platforms";
import type { Account } from "@/lib/types";
import type { PostImageSettings } from "@/lib/watermark";
import { PlatformBadge } from "@/components/shared/platform-badge";
import { WatermarkedImage } from "@/components/shared/watermarked-image";
import { cn } from "@/lib/utils";

type Media = { url: string; type?: string; name?: string };
type Props = { accounts: Account[]; content: string; media: Media[]; logo: PostImageSettings | null };

const X_LIMIT = 280;
const isStill = (m: Media) => (m.type ?? "image") === "image" && !/\.gif(\?|$)/i.test(m.url);

/** Text cut where the network shows "… más" before expanding. */
function Clamp({ text, at, more }: { text: string; at: number; more: string }) {
  if (text.length <= at) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <span className="whitespace-pre-wrap">
      {text.slice(0, at).trimEnd()}… <span className="text-muted-foreground">{more}</span>
    </span>
  );
}

function Header({ account, sub }: { account: Account; sub?: string }) {
  const name = account.displayName || account.username || platformName(account.platform);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {account.profilePicture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={account.profilePicture} alt="" className="size-8 rounded-full object-cover" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">{name.slice(0, 1)}</span>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold">{name}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      <MoreHorizontal className="size-4 text-muted-foreground" />
    </div>
  );
}

function Still({ m, logo, className }: { m: Media; logo: PostImageSettings | null; className?: string }) {
  if (m.type === "video")
    return <video src={m.url} className={cn("block w-full bg-black", className)} muted />;
  return <WatermarkedImage src={m.url} logo={isStill(m) ? logo : null} className={className} />;
}

/** Up to 4 tiles; the last one says "+N" when there are more (Facebook / X style). */
function Grid({ media, logo, rounded }: { media: Media[]; logo: PostImageSettings | null; rounded?: boolean }) {
  if (media.length === 1) return <Still m={media[0]} logo={logo} className={cn(rounded && "rounded-2xl border")} />;
  const shown = media.slice(0, 4);
  return (
    <div className={cn("grid grid-cols-2 gap-0.5 overflow-hidden", rounded && "rounded-2xl border")}>
      {shown.map((m, i) => (
        <div key={m.url} className={cn("relative aspect-square overflow-hidden", media.length === 3 && i === 0 && "row-span-2 aspect-auto")}>
          <div className="absolute inset-0 flex items-center bg-muted">
            <Still m={m} logo={logo} />
          </div>
          {i === 3 && media.length > 4 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">+{media.length - 4}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Instagram({ account, content, media, logo }: Omit<Props, "accounts"> & { account: Account }) {
  const [i, setI] = useState(0);
  const current = media[Math.min(i, media.length - 1)];
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border bg-background">
      <Header account={account} />
      {current ? (
        <div className="relative bg-black">
          <Still m={current} logo={logo} />
          {media.length > 1 && (
            <>
              <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 text-xs text-white">
                {Math.min(i, media.length - 1) + 1}/{media.length}
              </span>
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                {media.map((m, k) => (
                  <button key={m.url} aria-label={`Foto ${k + 1}`} onClick={() => setI(k)} className={cn("size-1.5 rounded-full", k === i ? "bg-white" : "bg-white/50")} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="bg-muted px-3 py-10 text-center text-xs text-muted-foreground">Instagram necesita al menos una imagen o video.</p>
      )}
      <div className="flex items-center gap-3 px-3 pt-2">
        <Heart className="size-5" />
        <MessageCircle className="size-5" />
        <Send className="size-5" />
        <Bookmark className="ml-auto size-5" />
      </div>
      <p className="px-3 py-2 text-sm">
        <span className="mr-1 font-semibold">{account.username || account.displayName}</span>
        <Clamp text={content} at={125} more="más" />
      </p>
    </div>
  );
}

function Facebook({ account, content, media, logo }: Omit<Props, "accounts"> & { account: Account }) {
  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-xl border bg-background">
      <Header account={account} sub="Ahora · 🌎" />
      {content && (
        <p className="px-3 pb-2 text-sm">
          <Clamp text={content} at={480} more="Ver más" />
        </p>
      )}
      {media.length > 0 && <Grid media={media} logo={logo} />}
      <div className="flex justify-around border-t py-1.5 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <ThumbsUp className="size-4" /> Me gusta
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="size-4" /> Comentar
        </span>
        <span className="flex items-center gap-1">
          <Share className="size-4" /> Compartir
        </span>
      </div>
    </div>
  );
}

function XPost({ account, content, media, logo }: Omit<Props, "accounts"> & { account: Account }) {
  const over = content.length - X_LIMIT;
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border bg-background p-3">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm">
            <span className="font-semibold">{account.displayName || account.username}</span>{" "}
            <span className="text-muted-foreground">@{account.username} · ahora</span>
          </p>
          <p className="text-sm whitespace-pre-wrap">
            {content.slice(0, X_LIMIT)}
            {over > 0 && <span className="bg-destructive/20 text-destructive">{content.slice(X_LIMIT)}</span>}
          </p>
          {media.length > 0 && <Grid media={media.slice(0, 4)} logo={logo} rounded />}
          <div className="flex justify-between pr-6 text-muted-foreground">
            <MessageCircle className="size-4" />
            <Repeat2 className="size-4" />
            <Heart className="size-4" />
            <Share className="size-4" />
          </div>
        </div>
      </div>
      {over > 0 && <p className="mt-2 text-xs text-destructive">Pasa {over} caracteres del límite de X ({X_LIMIT}).</p>}
      {media.length > 4 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">X muestra como máximo 4 imágenes.</p>}
    </div>
  );
}

function LinkedIn({ account, content, media, logo }: Omit<Props, "accounts"> & { account: Account }) {
  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-xl border bg-background">
      <Header account={account} sub="Ahora · 🌐" />
      {content && (
        <p className="px-3 pb-2 text-sm">
          <Clamp text={content} at={210} more="…ver más" />
        </p>
      )}
      {media.length > 0 && <Grid media={media} logo={logo} />}
      <div className="flex justify-around border-t py-1.5 text-xs text-muted-foreground">
        <span>Recomendar</span>
        <span>Comentar</span>
        <span>Compartir</span>
        <span>Enviar</span>
      </div>
    </div>
  );
}

function Vertical({ account, content, media, logo }: Omit<Props, "accounts"> & { account: Account }) {
  const video = media.find((m) => m.type === "video");
  return (
    <div className="mx-auto w-full max-w-[220px] space-y-1">
      <div className="relative flex aspect-[9/16] items-center overflow-hidden rounded-2xl bg-black text-white">
        {video ? (
          <video src={video.url} className="size-full object-cover" muted />
        ) : media[0] ? (
          <Still m={media[0]} logo={logo} />
        ) : null}
        <p className="absolute inset-x-2 bottom-2 line-clamp-3 text-xs drop-shadow">
          <span className="font-semibold">@{account.username}</span> {content}
        </p>
      </div>
      {!video && <p className="text-center text-xs text-amber-700 dark:text-amber-300">{platformName(account.platform)} publica videos: agrega uno.</p>}
    </div>
  );
}

function Generic({ account, content, media, logo }: Omit<Props, "accounts"> & { account: Account }) {
  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-xl border bg-background">
      <Header account={account} sub={platformName(account.platform)} />
      {content && <p className="px-3 pb-2 text-sm whitespace-pre-wrap">{content}</p>}
      {media.length > 0 && <Grid media={media} logo={logo} />}
    </div>
  );
}

const MOCKUP: Record<string, typeof Generic> = {
  instagram: Instagram,
  facebook: Facebook,
  twitter: XPost,
  linkedin: LinkedIn,
  tiktok: Vertical,
  youtube: Vertical,
};

/** How the post will look on each selected account, with the logo where it will be burnt in. */
export function PostPreview({ accounts, content, media, logo }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  if (!accounts.length) return <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Elige una cuenta para ver la vista previa.</p>;
  const account = accounts.find((a) => a._id === chosen) ?? accounts[0];
  const Mockup = MOCKUP[account.platform] ?? Generic;
  return (
    <div className="space-y-3">
      {accounts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => (
            <button
              key={a._id}
              type="button"
              onClick={() => setChosen(a._id)}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", a._id === account._id ? "border-primary bg-primary/10" : "hover:bg-muted")}
            >
              <PlatformBadge platform={a.platform} />
              {a.username || a.displayName}
            </button>
          ))}
        </div>
      )}
      <Mockup account={account} content={content} media={media} logo={logo} />
    </div>
  );
}
