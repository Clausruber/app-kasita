import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withUser } from "@/lib/auth-guard";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { tenantDoc, userDoc } from "@/lib/firebase/paths";
import { ensureTenant, isSuperAdmin, tenantStatus } from "@/lib/tenants";
import { ensureTestDriveAgenda } from "@/lib/agendas";

/**
 * The signed-in user's role, workspace and access (drives the dashboard gate, the nav and the tabs).
 * Team members act on their owner's workspace (`workspaceUid`) with the access the admin granted.
 */
export const GET = withUser(
  async (_req, user) => {
    const a = user.actor;
    if (!a.isOwner) {
      const workspaceStatus = await tenantStatus(a.uid);
      return NextResponse.json({
        uid: a.authUid,
        workspaceUid: a.uid,
        email: a.email,
        role: "member",
        sellerId: a.memberId,
        teamRole: a.role,
        perms: a.perms,
        status: a.status === "active" ? workspaceStatus : "disabled",
      });
    }
    await ensureTenant(user);
    const [superadmin, status] = await Promise.all([
      isSuperAdmin(user),
      tenantStatus(a.uid),
      ensureTestDriveAgenda(a.uid).catch((e) => console.warn("test drive agenda", e)),
    ]);
    return NextResponse.json({
      uid: a.authUid,
      workspaceUid: a.uid,
      email: a.email,
      role: superadmin ? "superadmin" : "admin",
      sellerId: "owner",
      teamRole: null,
      perms: null,
      status,
    });
  },
  { allowInactive: true },
);

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Sign-up details of a new company account (name, surname, WhatsApp, company). Fills Perfil and the
 * company name in Empresa, and shows the company to the SuperAdmin in the pending list.
 */
export const PUT = withUser(
  async (req, user) => {
    const a = user.actor;
    if (!a.isOwner) throw new HttpError(403, "Solo para cuentas de empresa");
    const b = (await req.json()) as Record<string, unknown>;
    const firstName = clip(b.firstName, 80);
    const lastName = clip(b.lastName, 120);
    const companyName = clip(b.company, 120);
    const wa = clip(b.whatsapp, 30).replace(/[\s().-]/g, "");
    if (!firstName) throw new HttpError(400, "Indica tu nombre");
    if (!companyName) throw new HttpError(400, "Indica el nombre de la empresa");
    if (!/^\+?\d{6,15}$/.test(wa)) throw new HttpError(400, "WhatsApp no válido: usa el número con prefijo de país");
    const whatsapp = wa.startsWith("+") ? wa : `+${wa}`;
    await ensureTenant(user);
    const ref = adminDb.doc(userDoc(a.uid));
    const current = (await ref.get()).data() ?? {};
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    await ref.set(
      {
        displayName,
        profile: { ...(current.profile ?? {}), firstName, lastName, phone: whatsapp },
        // Only the name: the rest of Empresa is completed later in Ajustes.
        company: { ...(current.company ?? {}), name: current.company?.name || companyName, whatsapp: current.company?.whatsapp || whatsapp },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await adminDb.doc(tenantDoc(a.uid)).set({ companyName, contactName: displayName, whatsapp }, { merge: true });
    await adminAuth.updateUser(a.authUid, { displayName });
    return NextResponse.json({ ok: true });
  },
  { allowInactive: true },
);
