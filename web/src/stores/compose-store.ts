import { create } from "zustand";
import { persist } from "zustand/middleware";

type MediaItem = { url: string; type?: string; name?: string };

type ComposeState = {
  content: string;
  accountIds: string[];
  mediaItems: MediaItem[];
  scheduledFor: string; // datetime-local value
  watermark: boolean | null; // logo on the images; null = the default from Ajustes → Imágenes
  setContent: (v: string) => void;
  toggleAccount: (id: string) => void;
  addMedia: (m: MediaItem) => void;
  removeMedia: (url: string) => void;
  setScheduledFor: (v: string) => void;
  setWatermark: (v: boolean) => void;
  reset: () => void;
};

const initial = { content: "", accountIds: [] as string[], mediaItems: [] as MediaItem[], scheduledFor: "", watermark: null as boolean | null };

// Draft survives navigation and reloads.
export const useComposeStore = create<ComposeState>()(
  persist(
    (set) => ({
      ...initial,
      setContent: (content) => set({ content }),
      toggleAccount: (id) =>
        set((s) => ({ accountIds: s.accountIds.includes(id) ? s.accountIds.filter((a) => a !== id) : [...s.accountIds, id] })),
      addMedia: (m) => set((s) => ({ mediaItems: [...s.mediaItems, m] })),
      removeMedia: (url) => set((s) => ({ mediaItems: s.mediaItems.filter((m) => m.url !== url) })),
      setScheduledFor: (scheduledFor) => set({ scheduledFor }),
      setWatermark: (watermark) => set({ watermark }),
      reset: () => set(initial),
    }),
    { name: "compose-draft" },
  ),
);
