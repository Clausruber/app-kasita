import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { withPerm, withUser } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { aiKnowledgeDoc, aiKnowledgeFilesCol, userDoc } from "@/lib/firebase/paths";
import { COMPANY_FILE_ID, companyMarkdown, parseCompany } from "@/lib/company";
import { recompile } from "@/lib/knowledge-store";

// Recompiling the agent manual calls the LLM.
export const maxDuration = 300;

export const GET = withUser(async (_req, user) => {
  const snap = await adminDb.doc(userDoc(user.uid)).get();
  return NextResponse.json({ company: snap.get("company") ?? null });
});

/**
 * Saves the company and regenerates its Markdown as an agent knowledge document (same place as the
 * PDFs), then rebuilds the agent manual. If the AI is not configured the manual is only flagged stale:
 * the agent still reads the company Markdown directly.
 */
export const PUT = withPerm("settings.empresa", async (req, user) => {
  const company = parseCompany(await req.json());
  const markdown = companyMarkdown(company);
  await adminDb.doc(userDoc(user.uid)).set({ company: { ...company, updatedAt: FieldValue.serverTimestamp() } }, { merge: true });
  await adminDb.collection(aiKnowledgeFilesCol(user.uid)).doc(COMPANY_FILE_ID).set({
    name: "Datos de la empresa.md",
    source: "company",
    pages: 0,
    chars: markdown.length,
    markdown,
    createdAt: FieldValue.serverTimestamp(),
  });
  let manual: "updated" | "stale" = "updated";
  try {
    await recompile(user.uid);
  } catch {
    manual = "stale";
    await adminDb.doc(aiKnowledgeDoc(user.uid)).set({ stale: true }, { merge: true });
  }
  return NextResponse.json({ company, markdown, manual });
});
