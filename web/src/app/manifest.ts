import type { MetadataRoute } from "next";

// Installable app (Add to Home Screen) with the Autolix icon.
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME || "Autolix";
  return {
    name,
    short_name: name,
    description: "Programa publicaciones y gestiona comentarios de tus redes sociales",
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
