import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withUser } from "@/lib/auth-guard";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { memberDoc, memberIndexDoc, userDoc } from "@/lib/firebase/paths";
import { roleLabel } from "@/lib/permissions";

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Perfil = the signed-in user's own data. Owners keep it on their workspace doc; team members on
 * their member record (name and email are set by the admin's invitation and are read-only here).
 */
export const GET = withUser(async (_req, user) => {
  const a = user.actor;
  const authUser = await adminAuth.getUser(a.authUid);
  if (a.isOwner) {
    const p = ((await adminDb.doc(userDoc(a.uid)).get()).get("profile") ?? {}) as Record<string, string>;
    return NextResponse.json({
      profile: { firstName: p.firstName ?? "", lastName: p.lastName ?? "", phone: p.phone ?? "", jobTitle: p.jobTitle ?? "", photoURL: p.photoURL ?? authUser.photoURL ?? "" },
      email: a.email,
      role: "Dueño de la cuenta",
      nameEditable: true,
    });
  }
  const m = (await adminDb.doc(memberDoc(a.uid, a.memberId!)).get()).data() ?? {};
  return NextResponse.json({
    profile: { firstName: m.firstName ?? "", lastName: m.lastName ?? "", phone: m.whatsapp ?? "", jobTitle: m.jobTitle ?? "", photoURL: m.photoURL ?? authUser.photoURL ?? "" },
    email: a.email,
    role: roleLabel(a.role),
    nameEditable: false,
  });
});

export const PUT = withUser(async (req, user) => {
  const a = user.actor;
  const b = (await req.json()) as Record<string, unknown>;
  const photoURL = clip(b.photoURL, 1000);
  if (photoURL && !/^https:\/\//.test(photoURL)) throw new HttpError(400, "Foto no válida");
  const phone = clip(b.phone, 30);
  if (phone && !/^\+?[\d\s().-]{6,20}$/.test(phone)) throw new HttpError(400, "Teléfono no válido");
  const jobTitle = clip(b.jobTitle, 80);

  if (a.isOwner) {
    const profile = { firstName: clip(b.firstName, 80), lastName: clip(b.lastName, 120), phone, jobTitle, photoURL };
    if (!profile.firstName) throw new HttpError(400, "Indica tu nombre");
    const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    await adminDb.doc(userDoc(a.uid)).set({ profile, displayName, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    // Only displayName/photoURL on the shared Auth user — never claims or email.
    await adminAuth.updateUser(a.authUid, { displayName, photoURL: photoURL || null });
    return NextResponse.json({ profile });
  }

  const ref = adminDb.doc(memberDoc(a.uid, a.memberId!));
  const m = (await ref.get()).data() ?? {};
  const whatsapp = phone.replace(/[\s().-]/g, "");
  await ref.update({ whatsapp: whatsapp && !whatsapp.startsWith("+") ? `+${whatsapp}` : whatsapp, jobTitle, photoURL, updatedAt: FieldValue.serverTimestamp() });
  await adminDb.doc(memberIndexDoc(a.authUid)).set({ photoURL }, { merge: true });
  await adminAuth.updateUser(a.authUid, { photoURL: photoURL || null });
  return NextResponse.json({ profile: { firstName: m.firstName, lastName: m.lastName, phone: whatsapp, jobTitle, photoURL } });
});
