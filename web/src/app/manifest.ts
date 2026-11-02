import type { MetadataRoute } from "next";

// Installable app (Add to Home Screen) with the Autolix icon.
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME || "Autolix";
  return {
    name: `${name} — La central de mando para lotes y agencias de autos`,
    short_name: name,
    description: "Gestiona tus lotes y agencias de autos y conecta tus redes sociales y WhatsApp en un solo lugar.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#001e62",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
