import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { listSellers, sellerIdOf } from "@/lib/deals-server";
import { adminDb } from "@/lib/firebase/admin";
import { clientDoc, conversationMessagesCol, quotesCol } from "@/lib/firebase/paths";
import { authorKeyOf, clientIdOf } from "@/lib/clients";
import { createQuote, getQuote, parseQuoteInput, quoteFileName, toQuoteRow, type QuoteDoc } from "@/lib/quotes-server";

// Quotes: up to 5 cars, optional financing and trade-in, shared as a public link (/c/{token});
// the PDF is rendered only when downloaded (api/quotes/[id]/pdf).

/** History: for a client or a conversation, or the latest of the workspace (optionally by status). */
export const GET = withPerm("inventory", async (req, user) => {
  const q = new URL(req.url).searchParams;
  const [field, value] = q.get("clientId") ? ["clientId", q.get("clientId")!] : q.get("conversationId") ? ["conversationId", q.get("conversationId")!] : [null, null];
  const col = adminDb.collection(quotesCol(user.uid));
  const snap = field ? await col.where(field, "==", value).limit(100).get() : await col.orderBy("createdAt", "desc").limit(200).get();
  const status = q.get("status");
  const quotes = snap.docs
    .map((d) => toQuoteRow(d.id, d.data() as QuoteDoc))
    .filter((r) => !status || r.status === status)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return NextResponse.json({ quotes });
});

/** Saves the quote (next folio) and returns its public link. */
export const POST = withPerm("inventory", async (req, user) => {
  const input = parseQuoteInput(await req.json());
  // From the inbox: link it to the conversation's client card (same id the inbox import uses).
  if (input.conversationId && !input.clientId) {
    const last = await adminDb.collection(conversationMessagesCol(user.uid, input.conversationId)).orderBy("createdAt", "desc").limit(20).get();
    const inbound = last.docs.find((d) => d.get("direction") === "in");
    const key = authorKeyOf(inbound?.get("author"));
    if (inbound?.get("platform") && key) {
      const clientId = clientIdOf(inbound.get("platform"), key);
      if ((await adminDb.doc(clientDoc(user.uid, clientId)).get()).exists) input.clientId = clientId;
    }
  }
  const sellerId = sellerIdOf(user);
  const seller = (await listSellers(user.uid)).find((s) => s.id === sellerId);
  const { id } = await createQuote(user.uid, input, { id: sellerId, name: seller?.name ?? "" });
  const quote = await getQuote(user.uid, id);
  return NextResponse.json({ ...toQuoteRow(id, quote), fileName: quoteFileName(quote) }, { status: 201 });
});
