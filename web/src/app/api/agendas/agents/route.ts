import { NextResponse } from "next/server";
import { withPerm } from "@/lib/auth-guard";
import { listSellers } from "@/lib/deals-server";

// Names of the agents (owner + active members) for the Agenda page: who attends each visit.
export const GET = withPerm("agenda", async (_req, user) => NextResponse.json({ agents: await listSellers(user.uid) }));
