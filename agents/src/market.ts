import { loadAgentKeypair, callContractEntryPoint, queryContractState, getRpcClient } from "./lib/casper.js";
import { config } from "./lib/config.js";
import { fetchCarbonPrice } from "./lib/carbonmark.js";
import { fetchCsprUsdPrice } from "./lib/price.js";
import type { Listing } from "./types.js";

const TARGET_SPREAD_BPS = 50;
const MIN_REPUTATION = 50;

async function getExternalCarbonPrice(): Promise<number | null> {
  if (!config.CARBON_PROJECT_KEY) {
    console.warn(`[Market] No CARBON_PROJECT_KEY configured — cannot fetch price`);
    return null;
  }
  return await fetchCarbonPrice(config.CARBON_PROJECT_KEY);
}

async function syncListings(): Promise<void> {
  console.log(`\n[Market] Syncing listings with external market...`);

  const externalPrice = await getExternalCarbonPrice();
  if (!externalPrice) {
    console.log(`[Market] No external price available, skipping`);
    return;
  }

  const csprPrice = await fetchCsprUsdPrice();
  if (!csprPrice) {
    console.log(`[Market] No CSPR price available, skipping`);
    return;
  }

  console.log(`[Market] External spot price: $${externalPrice}/tonne`);
  console.log(`[Market] CSPR/USD: $${csprPrice}`);

  const rpc = getRpcClient();
  const listingCount = await queryContractState(
    config.MARKETPLACE_CONTRACT_HASH,
    "next_listing_id",
  ) as number | null;

  if (!listingCount) {
    console.log(`[Market] No listings found on-chain`);
    return;
  }

  const externalPriceMotes = BigInt(Math.floor((externalPrice / csprPrice) * 1000000000));
  let adjusted = 0;

  for (let id = 0; id < listingCount; id++) {
    const listing = await queryContractState(
      config.MARKETPLACE_CONTRACT_HASH,
      `listings[${id}]`,
    ) as Listing | null;

    if (!listing || !listing.active) continue;

    const currentPrice = BigInt(listing.price_per_token);
    const diff = currentPrice > externalPriceMotes
      ? Number((currentPrice - externalPriceMotes) / BigInt(10000000))
      : Number((externalPriceMotes - currentPrice) / BigInt(10000000));

    if (diff > TARGET_SPREAD_BPS) {
      try {
        await callContractEntryPoint(
          config.MARKETPLACE_CONTRACT_HASH,
          "cancel_listing",
          { listing_id: id },
          "5000000000",
        );
        console.log(`[Market] Cancelled mispriced listing #${id}`);
        adjusted++;
      } catch (err: any) {
        console.error(`[Market] Failed to cancel listing #${id}: ${err?.message ?? err}`);
      }
    }
  }

  console.log(`[Market] Adjusted ${adjusted} listings`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║       Casper Carbon — Market Agent           ║
║      AI-Powered Carbon Credit Market Maker    ║
╚══════════════════════════════════════════════╝
  `);

  const { publicKey } = await loadAgentKeypair();
  console.log(`[Market] Agent public key: ${publicKey.toHex()}`);
  console.log(`[Market] Poll interval: ${config.POLL_INTERVAL_MS}ms\n`);

  async function poll() {
    try {
      await syncListings();
    } catch (err: any) {
      console.error(`[Market] Poll error: ${err?.message ?? err} — retrying next poll`);
    }
  }

  await poll();
  setInterval(poll, config.POLL_INTERVAL_MS);
}

main().catch(console.error);

