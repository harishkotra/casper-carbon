import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const listingId = parseInt(searchParams.get("listing_id") ?? "", 10);
    const tokenAmount = searchParams.get("token_amount") ?? "";
    const buyer = searchParams.get("buyer") ?? "";

    if (isNaN(listingId) || !tokenAmount || !buyer) {
      return NextResponse.json({ error: "listing_id, token_amount, and buyer are required" }, { status: 400 });
    }

    const marketplaceHash = process.env.MARKETPLACE_CONTRACT_HASH || "";
    const chainName = process.env.CASPER_CHAIN_NAME || "casper-test";

    return NextResponse.json({
      unsignedDeploy: {
        deploy_type: "contract_call",
        chain_name: chainName,
        contract_hash: `hash-${marketplaceHash}`,
        entry_point: "buy",
        args: [
          ["listing_id", { cl_type: "U32", value: listingId }],
          ["token_amount", { cl_type: "U256", value: tokenAmount }],
        ],
        payment: "5000000000",
      },
      rpcUrl: process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
