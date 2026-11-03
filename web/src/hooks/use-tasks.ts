"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase/client";
import { tasksCol } from "@/lib/firebase/paths";
import type { Task } from "@/lib/types";
import { useCan, useMe, useWorkspaceUid } from "@/hooks/use-me";

export type TasksData = { tasks: Task[]; me: string | null };

export function useTasks() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["tasks"], enabled: !!user, queryFn: () => api<TasksData>("/api/tasks") });
}

export function usePutTask() {
  const qc = useQueryClient();
  return (t: Task) =>
    qc.setQueryData<TasksData>(["tasks"], (old) =>
      old && { ...old, tasks: old.tasks.some((x) => x.id === t.id) ? old.tasks.map((x) => (x.id === t.id ? t : x)) : [...old.tasks, t] },
    );
}

export const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Live count of pending tasks due today or overdue for the sidebar badge. Single-field query (done ==
 * false) so no composite index is needed; the date and the assignee are filtered here.
 */
export function useTaskBadge() {
  const ws = useWorkspaceUid();
  const me = useMe().data;
  const can = useCan();
  const mine = me?.perms == null ? "owner" : null; // members' own id comes from the tasks API
  const { data } = useTasks();
  const meId = data?.me ?? mine;
  const all = can("tasks.all");
  const [count, setCount] = useState(0);
  const qc = useQueryClient();
  useEffect(() => {
    if (!ws || !can("tasks")) return;
    return onSnapshot(
      query(collection(db, tasksCol(ws)), where("done", "==", false)),
      (snap) => {
        const limit = endOfToday().getTime();
        setCount(
          snap.docs.filter((d) => {
            const due = d.get("dueAt")?.toMillis?.() ?? 0;
            const who = d.get("assigneeId") ?? null;
            return due <= limit && (all || !who || who === meId);
          }).length,
        );
        // Keep the Seguimientos page in step with tasks created by the scheduler or other people.
        qc.invalidateQueries({ queryKey: ["tasks"] });
      },
      () => setCount(0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, meId, all]);
  return count;
}
