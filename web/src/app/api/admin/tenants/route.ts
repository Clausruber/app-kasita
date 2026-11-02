import { NextResponse } from "next/server";
import { withSuperAdmin } from "@/lib/auth-guard";
import { listTenants } from "@/lib/admin-tenants";

export const GET = withSuperAdmin(async () => NextResponse.json({ tenants: await listTenants() }));
