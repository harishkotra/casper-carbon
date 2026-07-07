/**
 * Casper Carbon — Seed Script
 *
 * Seeds the deployed contracts with sample projects and agent registrations
 * so the demo has real data on Testnet.
 *
 * Usage: npm run seed
 */

import "dotenv/config";
import CasperSDK from "casper-js-sdk";
const {
  HttpHandler, RpcClient, PrivateKey, KeyAlgorithm,
  Deploy, DeployHeader, ExecutableDeployItem,
  StoredContractByHash, ContractHash, Args, CLValue, Key,
} = CasperSDK as any;
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

const CONFIG = {
  rpcUrl: process.env.CASPER_RPC_URL || "https://rpc.testnet.cspr.cloud",
  chainName: process.env.CASPER_CHAIN_NAME || "casper-test",
  pemPath: process.env.DEPLOYER_PEM_PATH || "",
  authToken: process.env.CSPR_CLOUD_AUTH_TOKEN || "",
};

function parseSec1Pem(pem: string) {
  const b64 = pem.replace(/-----.*?-----/g, "").replace(/\s/g, "");
  const der = new Uint8Array(Buffer.from(b64, "base64"));
  let oidStart = -1;
  for (let i = 0; i < der.length - 6; i++) {
    if (der[i] === 0x06 && der[i + 1] === 0x05) { oidStart = i + 2; break; }
  }
  let algorithm = KeyAlgorithm.ED25519;
  if (oidStart >= 0) {
    const oid = der.slice(oidStart, oidStart + 5);
    if (oid[0] === 0x2b && oid[1] === 0x81 && oid[2] === 0x04 && oid[3] === 0x00 && oid[4] === 0x0a) {
      algorithm = KeyAlgorithm.SECP256K1;
    }
  }
  let idx = -1;
  for (let i = 0; i < der.length - 1; i++) {
    if (der[i] === 0x04 && der[i + 1] === 0x20) { idx = i; break; }
  }
  if (idx < 0) throw new Error("Cannot find private key seed in EC PEM");
  const seed = der.slice(idx + 2, idx + 34);
  return PrivateKey.fromHex(Buffer.from(seed).toString("hex"), algorithm);
}

async function loadDeployer() {
  if (!CONFIG.pemPath) throw new Error("DEPLOYER_PEM_PATH not set in .env");
  const pem = fs.readFileSync(CONFIG.pemPath, "utf-8");
  if (pem.startsWith("-----BEGIN EC PRIVATE KEY-----")) return parseSec1Pem(pem);
  return PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
}

const SEED_PROJECTS = [
  {
    name: "Amazon Rainforest Conservation REDD+",
    metadata_hash: "QmX1Y2Z3...rainforest-conservation",
    location: "Amazonas, Brazil",
  },
  {
    name: "Solar Power Farm - Rajasthan",
    metadata_hash: "QmA4B5C6...solar-rajasthan",
    location: "Rajasthan, India",
  },
  {
    name: "Wind Power Project - Patagonia",
    metadata_hash: "QmD7E8F9...wind-patagonia",
    location: "Patagonia, Argentina",
  },
];

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║      Casper Carbon — Seed Script             ║
║     Populating Testnet with demo data        ║
╚══════════════════════════════════════════════╝
  `);

  const hashes = loadHashes();
  if (!hashes.agentRegistry || !hashes.registry || !hashes.token) {
    console.error("❌ Contract hashes not found. Run deploy.ts first.");
    process.exit(1);
  }

  const deployer = await loadDeployer();

  const handler = new HttpHandler(CONFIG.rpcUrl);
  if (CONFIG.authToken) handler.setCustomHeaders({ Authorization: CONFIG.authToken });
  const rpc = new RpcClient(handler);

  function makeHeader() {
    const header = DeployHeader.default();
    header.account = deployer.publicKey;
    header.chainName = CONFIG.chainName;
    header.gasPrice = 1;
    return header;
  }

  function makeDeploy(
    contractHash: string,
    entryPoint: string,
    clArgs: Record<string, any>,
    paymentAmount = "5000000000",
  ) {
    const session = new ExecutableDeployItem();
    session.storedContractByHash = new StoredContractByHash(
      ContractHash.newContract(contractHash),
      entryPoint,
      Args.fromMap(clArgs),
    );
    return Deploy.makeDeploy(makeHeader(), ExecutableDeployItem.standardPayment(paymentAmount), session);
  }

  async function submitAndWait(deploy: any, label: string) {
    deploy.sign(deployer);
    const result = await rpc.putDeploy(deploy);
    const hash = result.deployHash?.toHex?.() ?? String(result.deployHash ?? result.hash);
    try {
      const info: any = await rpc.waitForDeploy(deploy, 120000);
      const er = info?.executionInfo?.executionResult;
      const errMsg = er?.errorMessage || er?.Failure?.errorMessage;
      if (errMsg) throw new Error(errMsg);
      console.log(`  ✓ ${label} → ${hash}`);
    } catch (err: any) {
      if (err?.message?.startsWith("On-chain") || err?.message?.includes("failed")) {
        console.error(`  ✗ ${label} execution failed: ${err.message}`);
      } else {
        console.log(`  ✓ ${label} → ${hash} (submit confirmed, wait timed out)`);
      }
    }
    return hash;
  }

  // Agent registration and registry wiring are handled by fix-setup.ts
  // (one identity per agent type, package-hash wiring). Do NOT re-register
  // here — it would overwrite the main account's Verifier registration.

  // Register sample projects
  console.log("\nRegistering sample carbon projects...");
  for (const project of SEED_PROJECTS) {
    const deploy = makeDeploy(hashes.registry, "register_project", {
      name: CLValue.newCLString(project.name),
      metadata_hash: CLValue.newCLString(project.metadata_hash),
      location: CLValue.newCLString(project.location),
    });
    await submitAndWait(deploy, `"${project.name}"`);
  }

  console.log("\n✅ Seed complete! Testnet now has demo data.");
  console.log("Run: cd agents && npm run verifier");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
