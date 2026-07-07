import { NextResponse } from "next/server";
import { getAgent } from "@/lib/casper-read";
import { AGENT_KEYS, accountHashFromPublicKey } from "@/lib/csprcloud";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = Object.entries(AGENT_KEYS).filter(([, pk]) => pk);
    const agents = await Promise.all(
      entries.map(async ([role, publicKey]) => {
        const accountHash = accountHashFromPublicKey(publicKey);
        const info = await getAgent(accountHash);
        return { role, publicKey, accountHash, ...info };
      }),
    );
    return NextResponse.json(agents.filter((a) => a.name));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
