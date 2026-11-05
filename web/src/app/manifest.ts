import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Installable app (Add to Home Screen) with the Kasita icon.
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME || "Kasita";
  return {
    name: `${name} — El copiloto 24/7 para tu inmobiliaria`,
    short_name: name,
    description: "Cada cliente recibe respuesta al instante, a cualquier hora y en cualquier red. Un agente de IA atiende comentarios y mensajes, agenda visitas y da seguimiento a cada persona.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#d8790d",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
