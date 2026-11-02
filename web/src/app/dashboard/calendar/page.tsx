"use client";

import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { useBookings, usePosts } from "@/hooks/use-firestore";
import type { Post } from "@/lib/types";
import { BookingChip, BookingDetail } from "@/components/agenda/booking-detail";
import { BookButton } from "@/components/agenda/booking-modal";
import { platformColor } from "@/lib/platforms";
import { PostDetail } from "@/components/posts/post-detail";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type View = "month" | "week";
type Show = "all" | "posts" | "bookings";
const WEEK = { weekStartsOn: 1 as const, locale: es };

function PostChip({ post, onClick }: { post: Post; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-muted",
        post.status === "failed" && "text-destructive",
        post.status === "published" && "text-muted-foreground",
      )}
    >
      <span className="flex shrink-0 -space-x-1">
        {post.platforms.slice(0, 3).map((t, i) => (
          <span key={i} className="size-2 rounded-full ring-1 ring-background" style={{ background: platformColor(t.platform) }} />
        ))}
      </span>
      <span className="shrink-0 tabular-nums">{format(post.scheduledFor.toDate(), "HH:mm")}</span>
      <span className="truncate">{post.content || "(solo media)"}</span>
      {post.unreadCount > 0 && (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-primary">
          <MessageCircle className="size-3" />
          {post.unreadCount}
        </span>
      )}
    </button>
  );
}

export default function CalendarPage() {
  const { data: posts, loading, error } = usePosts();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = posts.find((p) => p.id === selectedId) ?? null;
  const [show, setShow] = useState<Show>("all");
  const [bookingId, setBookingId] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = view === "month" ? startOfWeek(startOfMonth(cursor), WEEK) : startOfWeek(cursor, WEEK);
    const end = view === "month" ? endOfWeek(endOfMonth(cursor), WEEK) : endOfWeek(cursor, WEEK);
    return eachDayOfInterval({ start, end });
  }, [cursor, view]);

  // Bookings of the visible range (held and confirmed), live.
  const { data: rangeBookings } = useBookings(days[0], addDays(days[days.length - 1], 1));
  const bookings = rangeBookings.filter((b) => b.status === "held" || b.status === "confirmed");
  const booking = bookings.find((b) => b.id === bookingId) ?? null;

  const move = (dir: 1 | -1) => setCursor((c) => (view === "month" ? addMonths(c, dir) : addWeeks(c, dir)));
  const title =
    view === "month"
      ? format(cursor, "MMMM yyyy", { locale: es })
      : `${format(days[0], "d MMM", { locale: es })} – ${format(days[6], "d MMM yyyy", { locale: es })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold capitalize">{title}</h1>
        <div className="flex rounded-lg border p-0.5">
          {(["all", "posts", "bookings"] as const).map((v) => (
            <Button key={v} size="sm" variant={show === v ? "secondary" : "ghost"} onClick={() => setShow(v)}>
              {v === "all" ? "Todo" : v === "posts" ? "Posts" : "Citas"}
            </Button>
          ))}
        </div>
        <div className="flex rounded-lg border p-0.5">
          {(["month", "week"] as const).map((v) => (
            <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"} onClick={() => setView(v)}>
              {v === "month" ? "Mes" : "Semana"}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="icon" aria-label="Anterior" onClick={() => move(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
          Hoy
        </Button>
        <Button variant="outline" size="icon" aria-label="Siguiente" onClick={() => move(1)}>
          <ChevronRight />
        </Button>
        <BookButton size="sm" />
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-lg border">
          {days.slice(0, 7).map((d) => (
            <div key={d.toISOString()} className="border-b bg-muted/50 px-2 py-1 text-xs font-medium capitalize">
              {format(d, "EEE", { locale: es })}
            </div>
          ))}
          {days.map((d) => {
            // Posts and bookings of the day, in time order.
            const items = [
              ...(show !== "bookings" ? posts.filter((p) => isSameDay(p.scheduledFor.toDate(), d)).map((p) => ({ at: p.scheduledFor.toMillis(), post: p })) : []),
              ...(show !== "posts" ? bookings.filter((b) => isSameDay(b.start.toDate(), d)).map((b) => ({ at: b.start.toMillis(), booking: b })) : []),
            ].sort((a, b) => a.at - b.at);
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  "space-y-0.5 border-r border-b p-1 [&:nth-child(7n)]:border-r-0",
                  view === "month" ? "min-h-24" : "min-h-80",
                  view === "month" && !isSameMonth(d, cursor) && "bg-muted/30 text-muted-foreground",
                )}
              >
                <div
                  className={cn(
                    "mb-0.5 inline-flex size-6 items-center justify-center rounded-full text-xs",
                    isToday(d) && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(d, "d")}
                </div>
                {items.map((it) =>
                  "post" in it ? (
                    <PostChip key={it.post.id} post={it.post} onClick={() => setSelectedId(it.post.id)} />
                  ) : (
                    <BookingChip key={it.booking.id} booking={it.booking} onClick={() => setBookingId(it.booking.id)} />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && <PostDetail key={selected.id} post={selected} onClose={() => setSelectedId(null)} />}
      {booking && <BookingDetail key={booking.id} booking={booking} onClose={() => setBookingId(null)} />}
    </div>
  );
}
