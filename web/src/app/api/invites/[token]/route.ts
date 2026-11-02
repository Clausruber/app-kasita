import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { inviteDoc, memberDoc, userDoc } from "@/lib/firebase/paths";
import { roleLabel } from "@/lib/permissions";
import { hashToken } from "@/lib/team";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Public: what the registration page shows for an invitation link (name, surname and email are
 * fixed by the admin). Reveals nothing for unknown or expired tokens.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  const inv = await adminDb.doc(inviteDoc(hashToken(token))).get();
  if (!inv.exists) return NextResponse.json({ error: "Invitación no válida o ya usada" }, { status: 404 });
  if (inv.get("expiresAt").toMillis() < Date.now()) return NextResponse.json({ error: "La invitación caducó: pide un enlace nuevo al administrador" }, { status: 410 });
  const [m, owner] = await Promise.all([
    adminDb.doc(memberDoc(inv.get("ownerUid"), inv.get("memberId"))).get(),
    adminDb.doc(userDoc(inv.get("ownerUid"))).get(),
  ]);
  if (!m.exists || m.get("status") !== "invited") return NextResponse.json({ error: "Invitación no válida o ya usada" }, { status: 404 });
  return NextResponse.json({
    firstName: m.get("firstName") ?? "",
    lastName: m.get("lastName") ?? "",
    email: m.get("email"),
    whatsapp: m.get("whatsapp") ?? "",
    role: roleLabel(m.get("role")),
    company: (owner.get("company.name") as string | undefined) ?? null,
    logoUrl: (owner.get("company.logoUrl") as string | undefined) ?? null,
  });
}
