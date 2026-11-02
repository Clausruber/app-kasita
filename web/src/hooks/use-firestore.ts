"use client";

import { useEffect, useState } from "react";
import { collection, collectionGroup, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  MESSAGES,
  accountsCol,
  agendasCol,
  bookingsCol,
  conversationMessagesCol,
  conversationsCol,
  postMessagesCol,
  postsCol,
} from "@/lib/firebase/paths";
import { useWorkspaceUid } from "@/hooks/use-me";
import type { AccountDoc, Agenda, Booking, Conversation, Message, Post } from "@/lib/types";

type Live<T> = { data: T[]; loading: boolean; error: Error | null };

function useLive<T>(subscribe: ((set: (s: Live<T>) => void) => () => void) | null, deps: unknown[]): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: [], loading: true, error: null });
  useEffect(() => {
    if (!subscribe) return;
    return subscribe(setState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** All of the user's posts, live. */
export function usePosts() {
  const ws = useWorkspaceUid();
  return useLive<Post>(
    ws
      ? (set) =>
          onSnapshot(
            query(collection(db, postsCol(ws)), orderBy("scheduledFor", "asc")),
            (snap) =>
              set({
                data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Post).filter((p) => !p.hidden),
                loading: false,
                error: null,
              }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws],
  );
}

/** Connected accounts mirrored in Firestore (avatar, username), live. */
export function useAccountDocs() {
  const ws = useWorkspaceUid();
  return useLive<AccountDoc>(
    ws
      ? (set) =>
          onSnapshot(
            collection(db, accountsCol(ws)),
            (snap) => set({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AccountDoc), loading: false, error: null }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws],
  );
}

const toMessage =(d: { id: string; ref: { path: string }; data: () => unknown }) =>
  ({ id: d.id, path: d.ref.path, ...(d.data() as object) }) as Message;

/** Latest comments and DMs across all posts/conversations (unified inbox), live. */
export function useInbox(max = 200) {
  const ws = useWorkspaceUid();
  return useLive<Message>(
    ws
      ? (set) =>
          onSnapshot(
            query(
              collectionGroup(db, MESSAGES),
              where("uid", "==", ws),
              where("kind", "in", ["comment", "dm"]), // required by the security rule
              orderBy("createdAt", "desc"),
              limit(max),
            ),
            (snap) => set({ data: snap.docs.map(toMessage), loading: false, error: null }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws, max],
  );
}

/** The comment thread of one post, live. */
export function usePostMessages(postId: string | null) {
  const ws = useWorkspaceUid();
  return useLive<Message>(
    ws && postId
      ? (set) =>
          onSnapshot(
            query(collection(db, postMessagesCol(ws, postId)), orderBy("createdAt", "asc")),
            (snap) => set({ data: snap.docs.map(toMessage), loading: false, error: null }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws, postId],
  );
}

/** DM conversations, most recent first, live. */
export function useConversations() {
  const ws = useWorkspaceUid();
  return useLive<Conversation>(
    ws
      ? (set) =>
          onSnapshot(
            query(collection(db, conversationsCol(ws)), orderBy("lastMessageAt", "desc"), limit(200)),
            (snap) => set({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Conversation), loading: false, error: null }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws],
  );
}

/** Messages of one DM conversation, oldest first, live. */
export function useConversationMessages(convId: string | null) {
  const ws = useWorkspaceUid();
  return useLive<Message>(
    ws && convId
      ? (set) =>
          onSnapshot(
            query(collection(db, conversationMessagesCol(ws, convId)), orderBy("createdAt", "asc")),
            (snap) => set({ data: snap.docs.map(toMessage), loading: false, error: null }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws, convId],
  );
}

/** Service agendas, live. */
export function useAgendas() {
  const ws = useWorkspaceUid();
  return useLive<Agenda>(
    ws
      ? (set) =>
          onSnapshot(
            collection(db, agendasCol(ws)),
            (snap) =>
              set({
                data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Agenda).sort((a, b) => a.service.localeCompare(b.service)),
                loading: false,
                error: null,
              }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws],
  );
}

/** Bookings starting in [from, to), live. */
export function useBookings(from: Date, to: Date) {
  const ws = useWorkspaceUid();
  const [f, t] = [from.getTime(), to.getTime()];
  return useLive<Booking>(
    ws
      ? (set) =>
          onSnapshot(
            query(collection(db, bookingsCol(ws)), where("start", ">=", from), where("start", "<", to), orderBy("start", "asc")),
            (snap) => set({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking), loading: false, error: null }),
            (error) => set({ data: [], loading: false, error }),
          )
      : null,
    [ws, f, t],
  );
}
