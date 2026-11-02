import { NextResponse } from "next/server";
import { withUser } from "@/lib/auth-guard";
import { adminDb } from "@/lib/firebase/admin";
import { accountsCol } from "@/lib/firebase/paths";
import { getProfileForUser, indexAccounts, zernio, type ZernioAccount } from "@/lib/zernio";

// Lists the user's connected accounts from Zernio and mirrors them into Firestore.
export const GET = withUser(async (_req, user) => {
  const profileId = await getProfileForUser(user.uid, user.email);
  const { accounts } = await zernio<{ accounts: ZernioAccount[] }>(user.uid, "/accounts", { query: { profileId } });

  await indexAccounts(user.uid, accounts);
  const col = adminDb.collection(accountsCol(user.uid));
  const batch = adminDb.batch();
  for (const a of accounts) {
    batch.set(
      col.doc(a._id),
      {
        platform: a.platform,
        username: a.username ?? a.displayName ?? null,
        picture: a.profilePicture ?? null,
        isActive: a.isActive ?? true,
      },
      { merge: true },
    );
  }
  await batch.commit();

  return NextResponse.json({ accounts });
});
