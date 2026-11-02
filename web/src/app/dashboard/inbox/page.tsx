"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { PLATFORMS } from "@/lib/platforms";
import type { Post } from "@/lib/types";
import { useAccountDocs, useConversationMessages, useConversations, usePostMessages, usePosts } from "@/hooks/use-firestore";
import { PostCard } from "@/components/inbox/post-card";
import { CommenterList, groupCommenters } from "@/components/inbox/commenter-list";
import { Conversation } from "@/components/inbox/conversation";
import { Button } from "@/components/ui/button";
import { AgentModeToggle } from "@/components/inbox/agent-mode-toggle";
import { DmList, DmThread } from "@/components/inbox/dm-thread";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

type Filter = "all" | "unread";
type Channel = "comments" | "dms";

const isPublished = (p: Post) => p.source === "external" || ["published", "partial"].includes(p.status);
const activity = (p: Post) => (p.lastCommentAt ?? p.scheduledFor)?.toMillis() ?? 0;

/**
 * Inbox in three columns: posts → people who commented → conversation.
 * Everything is read live from Firestore; comments arrive through the dfZernioWebhook function
 * and /api/inbox/sync fills in pictures, likes and older comments.
 */
export default function InboxPage() {
  const { data: posts, loading, error } = usePosts();
  const { data: accounts } = useAccountDocs();
  const [filter, setFilter] = useState<Filter>("all");
  const [platform, setPlatform] = useState("all");
  const [postId, setPostId] = useState<string | null>(null);
  const [commenterKey, setCommenterKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const can = useCan();
  const channels = (["comments", "dms"] as const).filter((c) => can(c === "comments" ? "inbox.comments" : "inbox.dms"));
  const [chosenChannel, setChannel] = useState<Channel>("comments");
  const channel: Channel = channels.includes(chosenChannel) ? chosenChannel : (channels[0] ?? "comments");
  const [convId, setConvId] = useState<string | null>(null);
  const { data: conversations, loading: loadingConvs } = useConversations();
  const { data: dmMessages } = useConversationMessages(channel === "dms" ? convId : null);
  const visibleConvs = conversations
    .filter((c) => platform === "all" || c.platform === platform)
    .filter((c) => filter === "all" || (c.unreadCount ?? 0) > 0);
  const conversation = conversations.find((c) => c.id === convId) ?? null;
  const unreadDms = conversations.reduce((n, c) => n + (c.unreadCount ?? 0), 0);
  const synced = useRef(false);

  const sync = useCallback(async (manual: boolean) => {
    setSyncing(true);
    try {
      const r = await api<{ posts: number; backfilled: number }>("/api/inbox/sync", { method: "POST" });
      if (manual) toast.success(`Sincronizado: ${r.posts} posts, ${r.backfilled} comentarios nuevos`);
    } catch (e) {
      if (manual) toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    sync(false);
  }, [sync]);

  const visiblePosts = useMemo(
    () =>
      posts
        .filter(isPublished)
        .filter((p) => platform === "all" || p.platforms?.some((t) => t.platform === platform))
        .filter((p) => filter === "all" || p.unreadCount > 0)
        .sort((a, b) => activity(b) - activity(a)),
    [posts, platform, filter],
  );
  const usedPlatforms = PLATFORMS.filter((p) => posts.some((post) => post.platforms?.some((t) => t.platform === p.id)));

  const post = posts.find((p) => p.id === postId) ?? null;
  const { data: messages, loading: loadingMessages } = usePostMessages(postId);
  const commenters = useMemo(() => groupCommenters(messages), [messages]);
  const commenter = commenters.find((c) => c.key === commenterKey) ?? null;

  function selectPost(id: string) {
    setPostId(id);
    setCommenterKey(null);
  }

  // On small screens only one column is visible at a time.
  const step = commenter ? 3 : post ? 2 : 1;

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-3 md:h-[calc(100dvh-3rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <div className="mr-auto flex rounded-lg border p-0.5">
          {channels.map((c) => (
            <Button key={c} size="sm" variant={channel === c ? "secondary" : "ghost"} onClick={() => setChannel(c)}>
              {c === "comments" ? "Comentarios" : "Mensajes"}
              {c === "dms" && unreadDms > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{unreadDms}</span>}
            </Button>
          ))}
        </div>
        {(can("inbox.agentMode") || can("settings.agente")) && <AgentModeToggle />}
        <div className="flex rounded-lg border p-0.5">
          {(["all", "unread"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)}>
              {f === "all" ? "Todos" : "Sin leer"}
            </Button>
          ))}
        </div>
        <select
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Filtrar por red"
        >
          <option value="all">Todas las redes</option>
          {usedPlatforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => sync(true)}>
          <RefreshCw className={cn(syncing && "animate-spin")} /> Actualizar
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {channel === "dms" ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", conversation ? "hidden lg:flex" : "flex")}>
            <h2 className="border-b px-3 py-2 text-sm font-semibold">Mensajes directos</h2>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <DmList conversations={visibleConvs} selectedId={convId} onSelect={setConvId} loading={loadingConvs} />
            </div>
          </section>
          <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", conversation ? "flex" : "hidden lg:flex")}>
            <h2 className="flex items-center gap-1 border-b px-3 py-2 text-sm font-semibold">
              <Button variant="ghost" size="icon-xs" className="lg:hidden" aria-label="Volver" onClick={() => setConvId(null)}>
                <ArrowLeft />
              </Button>
              {conversation ? `Conversación con ${conversation.participant?.name || "Usuario"}` : "Conversación"}
            </h2>
            {conversation ? (
              <DmThread key={conversation.id} conversation={conversation} messages={dmMessages} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Selecciona una conversación.</p>
            )}
          </section>
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(280px,340px)_minmax(220px,280px)_minmax(0,1fr)]">
        {/* 1 · Posts */}
        <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", step === 1 ? "flex" : "hidden lg:flex")}>
          <h2 className="border-b px-3 py-2 text-sm font-semibold">Publicaciones</h2>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {loading && <p className="p-2 text-sm text-muted-foreground">Cargando…</p>}
            {!loading && !visiblePosts.length && (
              <p className="p-2 text-sm text-muted-foreground">
                {filter === "unread" ? "No hay comentarios sin leer." : "Aún no hay publicaciones."}
              </p>
            )}
            {visiblePosts.map((p) => (
              <PostCard key={p.id} post={p} accounts={accounts} selected={p.id === postId} onClick={() => selectPost(p.id)} />
            ))}
          </div>
        </section>

        {/* 2 · People who commented */}
        <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", step === 2 ? "flex" : "hidden lg:flex")}>
          <h2 className="flex items-center gap-1 border-b px-3 py-2 text-sm font-semibold">
            <Button variant="ghost" size="icon-xs" className="lg:hidden" aria-label="Volver" onClick={() => setPostId(null)}>
              <ArrowLeft />
            </Button>
            Comentarios {post && commenters.length > 0 && <span className="font-normal text-muted-foreground">· {commenters.length}</span>}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {post ? (
              <CommenterList
                commenters={commenters}
                selectedKey={commenterKey}
                onSelect={setCommenterKey}
                loading={loadingMessages}
              />
            ) : (
              <p className="p-2 text-sm text-muted-foreground">Selecciona una publicación.</p>
            )}
          </div>
        </section>

        {/* 3 · Conversation */}
        <section className={cn("min-h-0 flex-col overflow-hidden rounded-xl border", step === 3 ? "flex" : "hidden lg:flex")}>
          <h2 className="flex items-center gap-1 border-b px-3 py-2 text-sm font-semibold">
            <Button variant="ghost" size="icon-xs" className="lg:hidden" aria-label="Volver" onClick={() => setCommenterKey(null)}>
              <ArrowLeft />
            </Button>
            {commenter ? `Conversación con ${commenter.name}` : "Conversación"}
          </h2>
          {post && commenter ? (
            <Conversation key={`${post.id}:${commenter.key}`} post={post} messages={messages} commenter={commenter} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {post ? "Elige a la persona que comentó para ver la conversación." : "Selecciona una publicación y un comentario."}
            </p>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
