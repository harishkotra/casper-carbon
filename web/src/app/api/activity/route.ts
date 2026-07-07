import { NextResponse } from "next/server";
import { getAgentActivity } from "@/lib/csprcloud";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAgentActivity());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
