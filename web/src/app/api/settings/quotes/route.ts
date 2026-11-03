import { NextResponse } from "next/server";
import { withPerm, withUser } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { userDoc } from "@/lib/firebase/paths";
import { parseQuoteDefaults, readQuoteDefaults } from "@/lib/quotes-server";

// Defaults for catalogs/quotes (rate, minimum down payment, terms, validity, conditions).
// Every seller reads them (the catalog drawer); Ajustes → Empresa changes them.
export const GET = withUser(async (_req, user) => NextResponse.json(await readQuoteDefaults(user.uid)));

export const PUT = withPerm("settings.empresa", async (req, user) => {
  const defaults = parseQuoteDefaults(await req.json());
  await adminDb.doc(userDoc(user.uid)).set({ quoteDefaults: defaults }, { merge: true });
  return NextResponse.json(defaults);
});
