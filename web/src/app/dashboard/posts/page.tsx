"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Heart, MessageCircle, Newspaper, Plus } from "lucide-react";
import { usePosts } from "@/hooks/use-firestore";
import type { Post } from "@/lib/types";
import { PlatformBadge } from "@/components/shared/platform-badge";
import { PostDetail } from "@/components/posts/post-detail";
import { StatusBadge } from "@/components/posts/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCan } from "@/hooks/use-me";

type Filter = "all" | "scheduled" | "published" | "failed";
const FILTERS: { id: Filter; label: string; match: (p: Post) => boolean }[] = [
  { id: "all", label: "Todas", match: () => true },
  { id: "scheduled", label: "Programadas", match: (p) => ["scheduled", "publishing", "draft"].includes(p.status) },
  { id: "published", label: "Publicadas", match: (p) => p.status === "published" },
  { id: "failed", label: "Con errores", match: (p) => ["failed", "partial"].includes(p.status) },
];

/**
 * Vista de publicaciones en dos columnas:
 * - 40%: Lista de publicaciones con filtros y estados.
 * - 60%: Detalle del post y módulo interactivo de comentarios (con el primero seleccionado por defecto).
 */
export default function PostsPage() {
  const { data, loading, error } = usePosts();
  const [filter, setFilter] = useState<Filter>("all");
  const canCreate = useCan()("posts.create");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Posts creados en esta app ordenados cronológicamente (más recientes primero)
  const posts = useMemo(
    () => data.filter((p) => p.source !== "external").sort((a, b) => b.scheduledFor.toMillis() - a.scheduledFor.toMillis()),
    [data],
  );
  const visible = useMemo(() => posts.filter(FILTERS.find((f) => f.id === filter)!.match), [posts, filter]);

  // Selección automática: siempre mantiene seleccionado el primer post si no hay selección o si la actual no está en la lista visible
  useEffect(() => {
    if (visible.length > 0) {
      if (!selectedId || !visible.some((p) => p.id === selectedId)) {
        setSelectedId(visible[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  const selected = visible.find((p) => p.id === selectedId) ?? (visible.length > 0 ? visible[0] : null);

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] md:h-[calc(100dvh-5.5rem)] flex-col gap-3 min-h-0">
      {/* Barra superior de herramientas y filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Publicaciones</h1>
          {posts.length > 0 && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {posts.length} {posts.length === 1 ? "post" : "posts"}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            {FILTERS.map((f) => {
              const count = posts.filter(f.match).length;
              return (
                <Button
                  key={f.id}
                  size="sm"
                  variant={filter === f.id ? "secondary" : "ghost"}
                  onClick={() => setFilter(f.id)}
                  className={cn("h-7 text-xs px-2.5", filter === f.id && "bg-background shadow-2xs font-medium")}
                >
                  {f.label} <span className="ml-1 text-[11px] text-muted-foreground">({count})</span>
                </Button>
              );
            })}
          </div>

          {canCreate && (
            <Link href="/dashboard/posts/new" className={cn(buttonVariants({ size: "sm" }), "h-8 gap-1.5")}>
              <Plus className="size-4" /> Nueva publicación
            </Link>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* Contenedor de dos columnas: 40% Posts | 60% Comentarios y Detalle */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row gap-4">
        {/* Columna 40%: Lista de posts */}
        <div className="flex flex-col min-h-0 w-full md:w-[40%] rounded-2xl border bg-card p-3 shadow-xs">
          {loading && (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              Cargando publicaciones…
            </div>
          )}

          {!loading && !visible.length && (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Newspaper className="size-8 stroke-[1.5] text-muted-foreground/40 mb-2" />
              <p>{posts.length ? "No hay publicaciones con este filtro." : "Aún no has creado ninguna publicación."}</p>
              {!posts.length && canCreate && (
                <div className="mt-3">
                  <Link href="/dashboard/posts/new" className={buttonVariants({ size: "sm" })}>
                    <Plus /> Crear la primera
                  </Link>
                </div>
              )}
            </div>
          )}

          {!loading && visible.length > 0 && (
            <ul className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
              {visible.map((p) => {
                const thumb = p.picture || p.mediaItems?.find((m) => m.type !== "video")?.url;
                const isSelected = p.id === (selected?.id ?? selectedId);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={cn(
                        "flex w-full gap-3 rounded-xl border p-3 text-left transition-all",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                          : "border-border/60 hover:border-border hover:bg-muted/40",
                      )}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="size-16 shrink-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground/50">
                          <Newspaper className="size-6" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={p.status} />
                          <span className="text-[11px] text-muted-foreground">
                            {p.status === "published" ? "Publicado" : "Programado"} ·{" "}
                            {format(p.scheduledFor.toDate(), "d MMM, HH:mm", { locale: es })}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-sm text-foreground/90">{p.content || "(solo media)"}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-0.5">
                          {p.platforms.map((t, i) => (
                            <PlatformBadge
                              key={`${t.platform}-${i}`}
                              platform={t.platform}
                              className={cn(t.status === "failed" && "text-destructive")}
                            />
                          ))}
                          {(p.likeCount ?? 0) > 0 && (
                            <span className="flex items-center gap-0.5 text-rose-500 font-medium text-[11px]">
                              <Heart className="size-3 fill-rose-500/20" /> {p.likeCount}
                            </span>
                          )}
                          <span
                            className={cn(
                              "flex items-center gap-1 font-medium text-[11px]",
                              (p.commentCount ?? 0) > 0 ? "text-primary" : "text-muted-foreground",
                            )}
                          >
                            <MessageCircle className="size-3" /> {p.commentCount ?? 0}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Columna 60%: Detalle y Comentarios */}
        <div className="flex flex-col min-h-0 w-full md:w-[60%]">
          {selected ? (
            <PostDetail key={selected.id} post={selected} embedded={true} />
          ) : (
            <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center text-muted-foreground bg-muted/10">
              <MessageCircle className="size-12 stroke-[1.5] text-muted-foreground/40 mb-3" />
              <h3 className="text-base font-medium text-foreground">Selecciona una publicación</h3>
              <p className="mt-1 text-sm max-w-sm text-muted-foreground">
                {posts.length === 0
                  ? "Crea tu primera publicación para ver sus detalles y gestionar los comentarios aquí."
                  : "Elige una publicación de la columna izquierda para ver su contenido y responder a los comentarios."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
