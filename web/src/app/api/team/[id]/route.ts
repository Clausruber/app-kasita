import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminAuth } from "@/lib/firebase/admin";
import { parseAvailability } from "@/lib/agendas";
import { normalisePerms } from "@/lib/permissions";
import { deleteMember, getMember, parseRole, parseWhatsapp, syncIndex, toMemberRow } from "@/lib/team";

type Ctx = { params: Promise<{ id: string }> };

const notSelf = (memberId: string, actorMemberId: string | null) => {
  if (memberId === actorMemberId) throw new HttpError(400, "No puedes cambiar tu propio acceso");
};

/** Role, access items, WhatsApp, visit hours and status (Activo / Inactivo) of a member. */
export const PUT = withPerm<Ctx>("settings.usuarios", async (req, user, { params }) => {
  const { id } = await params;
  notSelf(id, user.actor.memberId);
  const snap = await getMember(user.uid, id);
  const b = (await req.json()) as Record<string, unknown>;
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (b.role !== undefined) update.role = parseRole(b.role);
  if (b.perms !== undefined) update.perms = normalisePerms(b.perms);
  if (b.whatsapp !== undefined) update.whatsapp = parseWhatsapp(b.whatsapp);
  if (b.availability !== undefined) update.availability = parseAvailability(b.availability);
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "inactive") throw new HttpError(400, "Estado no válido");
    if (snap.get("status") === "invited") throw new HttpError(400, "La persona aún no aceptó la invitación");
    update.status = b.status;
  }
  await snap.ref.update(update);
  await syncIndex(user.uid, id);
  // Deactivated: also end their sessions (API, functions and rules already refuse inactive members).
  if (update.status === "inactive" && snap.get("uid")) await adminAuth.revokeRefreshTokens(snap.get("uid")).catch(() => {});
  return NextResponse.json({ member: toMemberRow(id, (await snap.ref.get()).data()!) });
});

export const DELETE = withPerm<Ctx>("settings.usuarios", async (_req, user, { params }) => {
  const { id } = await params;
  notSelf(id, user.actor.memberId);
  return NextResponse.json(await deleteMember(user.uid, id));
});
