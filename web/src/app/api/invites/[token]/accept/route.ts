import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, requireUser } from "@/lib/auth-guard";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { inviteDoc, memberDoc, memberIndexDoc, tenantDoc } from "@/lib/firebase/paths";
import { hashToken, parseWhatsapp, syncIndex } from "@/lib/team";

type Ctx = { params: Promise<{ token: string }> };

/**
 * The invited person, already signed in with the invited email (new account or existing one),
 * joins the workspace. Single use: the invitation is consumed.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as { whatsapp?: string };
    const invRef = adminDb.doc(inviteDoc(hashToken(token)));
    const inv = await invRef.get();
    if (!inv.exists) throw new HttpError(404, "Invitación no válida o ya usada");
    if (inv.get("expiresAt").toMillis() < Date.now()) throw new HttpError(410, "La invitación caducó: pide un enlace nuevo al administrador");
    if ((user.email ?? "").toLowerCase() !== inv.get("email")) throw new HttpError(403, `Entra con el email de la invitación (${inv.get("email")})`);

    const ownerUid = inv.get("ownerUid") as string;
    const memberId = inv.get("memberId") as string;
    if (user.uid === ownerUid) throw new HttpError(400, "Eres el dueño de esta cuenta");
    if ((await adminDb.doc(memberIndexDoc(user.uid)).get()).exists) throw new HttpError(409, "Este usuario ya pertenece a un equipo");
    // Someone with their own workspace cannot also be a member of another one.
    const ownTenant = await adminDb.doc(tenantDoc(user.uid)).get();
    if (ownTenant.exists && (ownTenant.get("zernioKey") || ownTenant.get("status") === "active"))
      throw new HttpError(409, "Este email ya tiene su propia cuenta de empresa");

    const mRef = adminDb.doc(memberDoc(ownerUid, memberId));
    const m = await mRef.get();
    if (!m.exists || m.get("status") !== "invited") throw new HttpError(404, "Invitación no válida o ya usada");

    const authUser = await adminAuth.getUser(user.uid);
    // Account created for this invitation (after it was issued): may be deleted with the member later.
    // Auth reports creationTime with second precision: compare whole seconds.
    const invitedAtSec = Math.floor((m.get("createdAt")?.toMillis() ?? Date.now()) / 1000);
    const createdAccount = Math.floor(new Date(authUser.metadata.creationTime).getTime() / 1000) >= invitedAtSec;
    const whatsapp = body.whatsapp !== undefined ? parseWhatsapp(body.whatsapp) : m.get("whatsapp");

    const batch = adminDb.batch();
    batch.update(mRef, { uid: user.uid, status: "active", whatsapp, createdAccount, inviteHash: FieldValue.delete(), acceptedAt: FieldValue.serverTimestamp() });
    batch.delete(invRef);
    // A pending self-registration record would list this person as a company in SuperAdmin.
    if (ownTenant.exists) batch.delete(ownTenant.ref);
    await batch.commit();
    await syncIndex(ownerUid, memberId);
    const displayName = [m.get("firstName"), m.get("lastName")].filter(Boolean).join(" ");
    await adminAuth.updateUser(user.uid, { displayName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
