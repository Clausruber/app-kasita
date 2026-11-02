import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Google Fonts, self-hosted by next/font (no request to Google at runtime).
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  display: "swap",
});

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Autolix";
const TITLE = `${APP_NAME} — La central de mando para lotes y agencias de autos`;
const DESCRIPTION = "Gestiona tus lotes y agencias de autos y conecta tus redes sociales y WhatsApp en un solo lugar.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Preview card when the link is shared on WhatsApp, Facebook, etc.
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: APP_NAME, locale: "es_MX", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
