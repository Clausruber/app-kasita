import { NextResponse } from "next/server";
import { HttpError, withSuperAdmin } from "@/lib/auth-guard";
import { listTenants, setTenantStatus, setTenantZernioKey } from "@/lib/admin-tenants";
import type { TenantStatus } from "@/lib/tenants";

type Ctx = { params: Promise<{ uid: string }> };
const STATUSES: TenantStatus[] = ["pending", "active", "disabled"];

// Assign an account's Zernio key and/or change its status. Saving a key never activates by itself
// unless `status: "active"` is sent too.
export const PUT = withSuperAdmin<Ctx>(async (req, user, { params }) => {
  const { uid } = await params;
  const body = (await req.json()) as { zernioKey?: string; status?: TenantStatus };
  if (body.status && !STATUSES.includes(body.status)) throw new HttpError(400, "Estado no válido");
  if (uid === user.uid && body.status && body.status !== "active") throw new HttpError(400, "No puedes desactivar tu propia cuenta");

  const actor = user.email ?? user.uid;
  if (body.zernioKey?.trim()) await setTenantZernioKey(uid, body.zernioKey.trim(), actor);
  if (body.status) await setTenantStatus(uid, body.status, actor);

  const row = (await listTenants()).find((t) => t.uid === uid);
  if (!row) throw new HttpError(404, "Usuario no encontrado");
  return NextResponse.json(row);
});
