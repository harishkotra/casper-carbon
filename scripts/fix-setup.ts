/**
 * Casper Carbon — Setup Repair Script
 *
 * Fixes two on-chain misconfigurations left by seed.ts:
 *  1. registry.agent_registry was wired to the agent registry's CONTRACT hash;
 *     cross-contract calls need the PACKAGE hash. Re-wires it correctly.
 *  2. The main account was registered as Verifier and then overwritten as
 *     Compliance (one mapping entry per address). Re-registers the main
 *     account as Verifier, and registers a NEW dedicated keypair as the
 *     Compliance agent (funded from the main account).
 *
 * Usage: npx tsx fix-setup.ts   (from scripts/, with .env configured)
 */

import "dotenv/config";
import CasperSDK from "casper-js-sdk";
const {
  HttpHandler, RpcClient, PrivateKey, KeyAlgorithm,
  Deploy, DeployHeader, ExecutableDeployItem,
  StoredContractByHash, ContractHash, Args, CLValue, Key,
  TransferDeployItem,
} = CasperSDK as any;
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadHashes(): { agentRegistry: string; registry: string } {
  const hashPath = path.join(__dirname, "contract-hashes.json");
  if (fs.existsSync(hashPath)) {
    return JSON.parse(fs.readFileSync(hashPath, "utf-8"));
  }
  return {
    agentRegistry: process.env.AGENT_REGISTRY_HASH || "",
    registry: process.env.REGISTRY_CONTRACT_HASH || "",
  };
}

const hashes = loadHashes();
const CONFIG = {
  rpcUrl: process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc",
  chainName: process.env.CASPER_CHAIN_NAME || "casper-test",
  pemPath: process.env.DEPLOYER_PEM_PATH || "",
  authToken: process.env.CSPR_CLOUD_AUTH_TOKEN || "",
  agentRegistry: hashes.agentRegistry,
  registry: hashes.registry,
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

async function rpcRaw(method: string, params: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (CONFIG.authToken) headers["Authorization"] = CONFIG.authToken;
  const r = await fetch(CONFIG.rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data: any = await r.json();
  if (data.error) throw new Error(`${method} failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function main() {
  if (!CONFIG.agentRegistry || !CONFIG.registry) {
    throw new Error("AGENT_REGISTRY_HASH / REGISTRY_CONTRACT_HASH not set in .env");
  }

  const deployer = await loadDeployer();
  console.log(`Admin account: ${deployer.publicKey.accountHash().toPrefixedString()}`);

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
    const info: any = await rpc.waitForDeploy(deploy, 180000);
    const er = info?.executionInfo?.executionResult;
    const errMsg = er?.errorMessage || er?.Failure?.errorMessage;
    if (errMsg) throw new Error(`${label} execution failed: ${errMsg}`);
    console.log(`  ✓ ${label} → ${hash}`);
    return hash;
  }

  // 1. Look up the agent registry's PACKAGE hash from the chain
  const stored = await rpcRaw("query_global_state", {
    state_identifier: null,
    key: `hash-${CONFIG.agentRegistry}`,
    path: [],
  });
  const packageHash: string = stored.stored_value.Contract.contract_package_hash
    .replace("contract-package-", "");
  console.log(`\nAgent registry package hash: ${packageHash}`);

  console.log("Re-wiring registry.agent_registry to the package hash...");
  await submitAndWait(
    makeDeploy(CONFIG.registry, "set_agent_registry", {
      agent_registry: CLValue.newCLKey(Key.newKey("hash-" + packageHash)),
    }),
    "agent_registry wired to package hash",
  );

  // 2. Re-register the main account as Verifier (overwrites the Compliance entry)
  console.log("\nRe-registering main account as Verifier...");
  const mainAddress = CLValue.newCLKey(Key.newKey(deployer.publicKey.accountHash().toPrefixedString()));
  await submitAndWait(
    makeDeploy(CONFIG.agentRegistry, "register_agent", {
      address: mainAddress,
      name: CLValue.newCLString("Verification Agent Alpha"),
      agent_type: CLValue.newCLUint8(0), // Verifier = 0
    }),
    "main account registered as Verifier",
  );

  // 3. Dedicated compliance keypair
  const compliancePemPath = path.join(__dirname, "compliance-key.pem");
  let complianceKey: any;
  if (fs.existsSync(compliancePemPath)) {
    console.log(`\nReusing existing compliance key at ${compliancePemPath}`);
    complianceKey = PrivateKey.fromPem(fs.readFileSync(compliancePemPath, "utf-8"), KeyAlgorithm.ED25519);
  } else {
    console.log(`\nGenerating compliance keypair → ${compliancePemPath}`);
    complianceKey = PrivateKey.generate(KeyAlgorithm.ED25519);
    fs.writeFileSync(compliancePemPath, complianceKey.toPem(), { mode: 0o600 });
  }
  const compliancePub = complianceKey.publicKey;
  console.log(`Compliance account: ${compliancePub.accountHash().toPrefixedString()}`);

  // Fund it so it can pay for slash deploys (200 CSPR)
  console.log("Funding compliance account with 200 CSPR...");
  const transferSession = new ExecutableDeployItem();
  transferSession.transfer = TransferDeployItem.newTransfer(
    "200000000000", compliancePub, null, Date.now(),
  );
  const transferDeploy = Deploy.makeDeploy(
    makeHeader(),
    ExecutableDeployItem.standardPayment("100000000"),
    transferSession,
  );
  await submitAndWait(transferDeploy, "compliance account funded");

  // Register it as the Compliance agent
  console.log("Registering compliance account as Compliance agent...");
  await submitAndWait(
    makeDeploy(CONFIG.agentRegistry, "register_agent", {
      address: CLValue.newCLKey(Key.newKey(compliancePub.accountHash().toPrefixedString())),
      name: CLValue.newCLString("Compliance Agent Beta"),
      agent_type: CLValue.newCLUint8(2), // Compliance = 2
    }),
    "compliance agent registered",
  );

  // 4. Point agents/.env at the compliance key
  const agentsEnvPath = path.join(__dirname, "..", "agents", ".env");
  if (fs.existsSync(agentsEnvPath)) {
    const envContent = fs.readFileSync(agentsEnvPath, "utf-8");
    const relPem = path.relative(path.join(__dirname, "..", "agents"), compliancePemPath);
    if (!envContent.includes("COMPLIANCE_PRIVATE_KEY=")) {
      fs.appendFileSync(agentsEnvPath, `\nCOMPLIANCE_PRIVATE_KEY=${relPem}\n`);
      console.log(`\nAdded COMPLIANCE_PRIVATE_KEY=${relPem} to agents/.env`);
    } else {
      console.log(`\nagents/.env already has COMPLIANCE_PRIVATE_KEY — leaving as is`);
    }
  }

  console.log(`
✅ Setup repaired. On-chain state now:
   - registry.agent_registry → package ${packageHash}
   - main account            → Verifier
   - compliance account      → Compliance (funded, key: scripts/compliance-key.pem)

Next: cd ../agents && npm run test:chain && npm run verifier
`);
}

main().catch((err) => {
  console.error("❌ fix-setup failed:", err);
  process.exit(1);
});
