import { withPerm } from "@/lib/auth-guard";
import { renderCatalogPdf } from "@/lib/catalog-pdf-render";
import { getQuote, quoteFileName, quotePath } from "@/lib/quotes-server";

type Ctx = { params: Promise<{ id: string }> };

// Re-renders a saved catalog: the cars were frozen when it was created, so it is the same document.
export const GET = withPerm<Ctx>("inventory", async (req, user, { params }) => {
  const { id } = await params;
  const quote = await getQuote(user.uid, id);
  // Same host the seller is using (local, preview or production).
  const link = quote.token ? `${process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost") ? process.env.NEXT_PUBLIC_APP_URL : new URL(req.url).origin}${quotePath(quote.token)}` : null;
  const pdf = await renderCatalogPdf(user.uid, quote, link);
  const name = quoteFileName(quote);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
});
