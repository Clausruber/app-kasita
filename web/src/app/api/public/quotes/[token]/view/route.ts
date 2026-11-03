import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpError } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { taskDoc } from "@/lib/firebase/paths";
import { isPreviewBot, quoteByToken } from "@/lib/quote-public";

type Ctx = { params: Promise<{ token: string }> };

const MIN_GAP_MS = 60_000; // reloads within a minute are the same visit

/** Public (no login): the customer opened the quote. First visit → follow-up task for the seller. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    if (isPreviewBot(req.headers.get("user-agent"))) return NextResponse.json({ counted: false });
    const { token } = await params;
    const { uid, quoteId, ref } = await quoteByToken(token);
    const first = await adminDb.runTransaction(async (tx) => {
      const q = await tx.get(ref);
      const last = (q.get("lastViewedAt") as Timestamp | null)?.toMillis() ?? 0;
      if (Date.now() - last < MIN_GAP_MS) return null;
      const isFirst = !q.get("firstViewedAt");
      tx.update(ref, {
        views: FieldValue.increment(1),
        lastViewedAt: FieldValue.serverTimestamp(),
        ...(isFirst ? { firstViewedAt: FieldValue.serverTimestamp(), ...(q.get("status") === "accepted" ? {} : { status: "viewed" }) } : {}),
      });
      return isFirst ? q.data()! : null;
    });
    if (first) {
      // Deterministic id: a second "first view" race can never create two tasks.
      await adminDb
        .doc(taskDoc(uid, `quote_viewed_${quoteId}`))
        .create({
          title: `${first.clientName || "Un cliente"} abrió tu cotización ${first.folio}`,
          dueAt: Timestamp.now(),
          assigneeId: first.sellerId ?? null,
          clientId: first.clientId ?? null,
          dealId: first.dealId ?? null,
          vehicleId: first.vehicles?.[0]?.id ?? null,
          conversationId: first.conversationId ?? null,
          kind: "quote_viewed",
          done: false,
          doneAt: null,
          notes: "",
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch((e: { code?: number }) => {
          if (e.code !== 6) throw e; // ALREADY_EXISTS
        });
    }
    return NextResponse.json({ counted: true });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("quote view", e);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
