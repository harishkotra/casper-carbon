import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signedDeploy } = body;
    if (!signedDeploy) {
      return NextResponse.json({ error: "signedDeploy is required" }, { status: 400 });
    }

    const rpcUrl = process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.CSPR_CLOUD_AUTH_TOKEN) {
      headers["Authorization"] = process.env.CSPR_CLOUD_AUTH_TOKEN;
    }

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "account_put_deploy",
        params: { deploy: signedDeploy },
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    return NextResponse.json({ deployHash: data.result?.deploy_hash ?? "" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
