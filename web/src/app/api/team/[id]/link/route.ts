import { NextResponse } from "next/server";
import { HttpError, withPerm } from "@/lib/auth-guard";
import { appOrigin, getMember, issueInvite } from "@/lib/team";

type Ctx = { params: Promise<{ id: string }> };

/** New invitation link for someone who has not accepted yet (the previous link stops working). */
export const POST = withPerm<Ctx>("settings.usuarios", async (req, user, { params }) => {
  const { id } = await params;
  const snap = await getMember(user.uid, id);
  if (snap.get("status") !== "invited") throw new HttpError(400, "Esta persona ya aceptó la invitación");
  return NextResponse.json({ invite: await issueInvite(user.uid, id, snap.get("email"), appOrigin(req)) });
});
