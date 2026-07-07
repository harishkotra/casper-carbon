/**
 * Casper Carbon — Verification Script
 *
 * Queries all deployed contracts to verify they're working.
 *
 * Usage: npm run verify
 */

import "dotenv/config";
import CasperSDK from "casper-js-sdk";
const { HttpHandler, RpcClient, PublicKey } = CasperSDK as any;
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ContractHashes {
  agentRegistry: string;
  registry: string;
  token: string;
  marketplace: string;
}

function loadHashes(): ContractHashes {
  const hashPath = path.join(__dirname, "contract-hashes.json");
  if (fs.existsSync(hashPath)) {
    return JSON.parse(fs.readFileSync(hashPath, "utf-8"));
  }
  return {
    agentRegistry: process.env.AGENT_REGISTRY_HASH || "",
    registry: process.env.REGISTRY_CONTRACT_HASH || "",
    token: process.env.TOKEN_CONTRACT_HASH || "",
    marketplace: process.env.MARKETPLACE_CONTRACT_HASH || "",
  };
}

async function main() {
  const hashes = loadHashes();
  const rpcUrl = process.env.CASPER_RPC_URL || "https://rpc.testnet.cspr.cloud";

  console.log(`
╔══════════════════════════════════════════════╗
║    Casper Carbon — Contract Verification     ║
╚══════════════════════════════════════════════╝
  `);

  const handler = new HttpHandler(rpcUrl);
  const rpc = new RpcClient(handler);

  console.log(`Network: ${process.env.CASPER_CHAIN_NAME || "casper-test"}`);
  console.log(`RPC:     ${rpcUrl}\n`);

  const checks = [
    { name: "AgentRegistry", hash: hashes.agentRegistry },
    { name: "CarbonProjectRegistry", hash: hashes.registry },
    { name: "CarbonCreditToken", hash: hashes.token },
    { name: "CarbonMarketplace", hash: hashes.marketplace },
  ];

  for (const contract of checks) {
    process.stdout.write(`${contract.name}: `);
    if (!contract.hash) {
      console.log(`⚠ Not configured`);
      continue;
    }

    try {
      const state = await rpc.getStateItem(contract.hash, []);
      console.log(`✓ ${contract.hash.slice(0, 16)}... (contract exists)`);
    } catch (err) {
      console.log(`✗ Error: ${err}`);
    }
  }

  // Query agent count
  process.stdout.write(`\nAgent count: `);
  try {
    const count = await rpc.getStateItem(hashes.agentRegistry, ["agent_count"]);
    console.log(`${count || 0}`);
  } catch {
    console.log(`0 (unable to query)`);
  }

  // Query project count
  process.stdout.write(`Project count: `);
  try {
    const count = await rpc.getStateItem(hashes.registry, ["next_project_id"]);
    console.log(`${count || 0}`);
  } catch {
    console.log(`0 (unable to query)`);
  }

  const explorerUrl = `https://testnet.cspr.live`;
  console.log(`\nView on CSPR Live:`);
  console.log(`  ${explorerUrl}/contract/${hashes.agentRegistry}`);
  console.log(`  ${explorerUrl}/contract/${hashes.registry}`);
  console.log(`  ${explorerUrl}/contract/${hashes.token}`);
  console.log(`  ${explorerUrl}/contract/${hashes.marketplace}`);
}

main().catch(console.error);
