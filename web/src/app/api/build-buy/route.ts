import { NextRequest, NextResponse } from "next/server";
import CasperSDK from "casper-js-sdk";

const {
  Deploy, DeployHeader, ExecutableDeployItem,
  StoredContractByHash, ContractHash, Args, CLValue, PublicKey,
} = CasperSDK as any;

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
    const rpcUrl = process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc";

    const header = DeployHeader.default();
    header.account = PublicKey.fromHex(buyer);
    header.chainName = chainName;
    header.gasPrice = 1;

    const session = new ExecutableDeployItem();
    session.storedContractByHash = new StoredContractByHash(
      ContractHash.fromPrefixed(`hash-${marketplaceHash}`),
      "buy",
      Args.fromMap({
        listing_id: CLValue.newCLUInt32(listingId),
        token_amount: CLValue.newCLUInt256(tokenAmount),
      }),
    );

    const deploy = Deploy.makeDeploy(
      header,
      ExecutableDeployItem.standardPayment("5000000000"),
      session,
    );

    return NextResponse.json({
      unsignedDeployJSON: Deploy.toJSON(deploy),
      rpcUrl,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
