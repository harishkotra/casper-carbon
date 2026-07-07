import { NextResponse } from "next/server";
import { getProjects } from "@/lib/casper-read";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getProjects());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
