export const PLATFORMS = [
  { id: "instagram", name: "Instagram", color: "#E1306C" },
  { id: "facebook", name: "Facebook", color: "#1877F2" },
  { id: "tiktok", name: "TikTok", color: "#000000" },
  { id: "youtube", name: "YouTube", color: "#FF0000" },
  { id: "linkedin", name: "LinkedIn", color: "#0A66C2" },
  { id: "twitter", name: "X / Twitter", color: "#111111" },
  { id: "threads", name: "Threads", color: "#333333" },
  { id: "bluesky", name: "Bluesky", color: "#1185FE" },
  { id: "pinterest", name: "Pinterest", color: "#E60023" },
  { id: "reddit", name: "Reddit", color: "#FF4500" },
  { id: "telegram", name: "Telegram", color: "#26A5E4" },
  { id: "googlebusiness", name: "Google Business", color: "#4285F4" },
  { id: "snapchat", name: "Snapchat", color: "#FFFC00" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];

export const platformName = (id: string) =>
  id === "manual" ? "Agendado a mano" : (PLATFORMS.find((p) => p.id === id)?.name ?? id);
export const platformColor = (id: string) => PLATFORMS.find((p) => p.id === id)?.color ?? "#888";
