import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { membersCol } from "@/lib/firebase/paths";
import { appOrigin, issueInvite, listMembers, parseInvite, toMemberRow } from "@/lib/team";

// Ajustes → Usuarios: the workspace's team.
export const GET = withPerm("settings.usuarios", async (_req, user) => NextResponse.json({ members: await listMembers(user.uid) }));

/** Creates a member in "invited" state and returns the invitation link (shown once). */
export const POST = withPerm("settings.usuarios", async (req, user) => {
  const data = parseInvite(await req.json());
  if (data.email === user.actor.email?.toLowerCase()) throw new HttpError(400, "No puedes invitarte a ti mismo");
  const col = adminDb.collection(membersCol(user.uid));
  if (!(await col.where("email", "==", data.email).limit(1).get()).empty) throw new HttpError(409, "Ya hay un usuario con ese email en el equipo");
  const ref = await col.add({ ...data, status: "invited", uid: null, invitedBy: user.actor.authUid, createdAt: FieldValue.serverTimestamp() });
  const invite = await issueInvite(user.uid, ref.id, data.email, appOrigin(req));
  return NextResponse.json({ member: toMemberRow(ref.id, (await ref.get()).data()!), invite }, { status: 201 });
});
