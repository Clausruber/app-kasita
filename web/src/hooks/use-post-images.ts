"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PostImageSettings } from "@/lib/watermark";

export type PostImages = PostImageSettings & { logoSource: "own" | "company" | "none"; companyLogoUrl: string };

/** Logo settings for post photos (Ajustes → Imágenes), used by the settings card and the composer. */
export function usePostImages() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["post-images", user?.uid], enabled: !!user, queryFn: () => api<PostImages>("/api/settings/images") });
}

export function useSetPostImages() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return (data: PostImages) => qc.setQueryData(["post-images", user?.uid], data);
}
