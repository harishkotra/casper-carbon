import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import CasperSDK from "casper-js-sdk";
const {
  HttpHandler, RpcClient, PrivateKey, PublicKey, KeyAlgorithm,
  Deploy, DeployHeader, ExecutableDeployItem,
  Args, CLValue, Key, StoredContractByHash, ContractHash,
} = CasperSDK;

interface ContractAddresses {
  agentRegistry: string;
  registry: string;
  token: string;
  marketplace: string;
}

interface DeployedContract {
  contractHash: string;
  packageHash: string;
}

const CONFIG = {
  rpcUrl: process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc",
  chainName: process.env.CASPER_CHAIN_NAME || "casper-test",
  pemPath: process.env.DEPLOYER_PEM_PATH || "",
  authToken: process.env.CSPR_CLOUD_AUTH_TOKEN || "",
  wasmDir: path.join(__dirname, "..", "contracts", "wasm"),
  gasPrice: 1,
};

async function loadDeployer() {
  if (!CONFIG.pemPath) {
    const key = await PrivateKey.generate(KeyAlgorithm.ED25519);
    console.log(`No DEPLOYER_PEM_PATH set. Generated temporary key.`);
    console.log(`  Public key: ${key.publicKey.toHex()}`);
    return key;
  }
  const pem = fs.readFileSync(CONFIG.pemPath, "utf-8");
  if (pem.startsWith("-----BEGIN EC PRIVATE KEY-----")) {
    return parseSec1Pem(pem);
  }
  return PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
}

function parseSec1Pem(pem: string) {
  const b64 = pem.replace(/-----.*?-----/g, "").replace(/\s/g, "");
  const der = new Uint8Array(Buffer.from(b64, "base64"));
  // Detect curve from OID in parameters [0] SEQUENCE: 06 05 <OID bytes>
  const oidMarker = new Uint8Array([0x06, 0x05]);
  let oidStart = -1;
  for (let i = 0; i < der.length - 6; i++) {
    if (der[i] === 0x06 && der[i + 1] === 0x05) { oidStart = i + 2; break; }
  }
  let algorithm = KeyAlgorithm.ED25519;
  if (oidStart >= 0) {
    const oid = der.slice(oidStart, oidStart + 5);
    // secp256k1 OID = 1.3.132.0.10 = 2b 81 04 00 0a
    if (oid[0] === 0x2b && oid[1] === 0x81 && oid[2] === 0x04 && oid[3] === 0x00 && oid[4] === 0x0a) {
      algorithm = KeyAlgorithm.SECP256K1;
    }
  }
  // Extract 32-byte private key seed from OCTET STRING (04 20)
  const marker = new Uint8Array([0x04, 0x20]);
  let idx = -1;
  for (let i = 0; i < der.length - 1; i++) {
    if (der[i] === 0x04 && der[i + 1] === 0x20) { idx = i; break; }
  }
  if (idx < 0) throw new Error("Cannot find private key seed in EC PEM");
  const seed = der.slice(idx + 2, idx + 34);
  return PrivateKey.fromHex(Buffer.from(seed).toString("hex"), algorithm);
}

function addressArg(pubKey: PublicKey): CLValue {
  return CLValue.newCLKey(Key.newKey(pubKey.accountHash().toPrefixedString()));
}

function contractAddressArg(contractHex: string): CLValue {
  return CLValue.newCLKey(Key.newKey("hash-" + contractHex));
}

async function deployWasm(
  rpc: RpcClient,
  deployer: PrivateKey,
  wasmPath: string,
  args: Args,
  paymentAmount: string,
): Promise<{ contractHash: string; packageHash: string }> {
  const wasmBytes = fs.readFileSync(wasmPath);

  const header = DeployHeader.default();
  header.account = deployer.publicKey;
  header.chainName = CONFIG.chainName;
  header.gasPrice = CONFIG.gasPrice;

  const deploy = Deploy.makeDeploy(
    header,
    ExecutableDeployItem.standardPayment(paymentAmount),
    ExecutableDeployItem.newModuleBytes(wasmBytes, args),
  );

  deploy.sign(deployer);
  const result: any = await rpc.putDeploy(deploy);
  const deployHashHex = (result.deployHash || result.hash).toHex();
  console.log(`  Deploy submitted: ${deployHashHex}`);

  const execInfo: any = await rpc.waitForDeploy(deploy, 300000);
  const er = execInfo.executionInfo?.executionResult;
  if (!er) throw new Error("No execution result found in deploy response");

  const errMsg = er.errorMessage || er.Failure?.errorMessage;
  if (errMsg) throw new Error(`Execution failed: ${errMsg}`);

  console.log(`  Cost: ${er.consumed}, Refund: ${er.refund}`);

  const effects = er.originExecutionResultV2?.effects || er.effects || [];
  let packageHash = "";
  let contractHash = "";
  for (const effect of effects) {
    const kindData = effect.kind?.data;
    if (kindData?.Write?.ContractPackage && !packageHash) {
      packageHash = typeof effect.key === 'string' ? effect.key : effect.key.toJSON();
    }
    if (kindData?.Write?.Contract && !contractHash) {
      contractHash = typeof effect.key === 'string' ? effect.key : effect.key.toJSON();
    }
  }
  if (!contractHash) throw new Error("No contract hash found in execution effects");
  console.log(`  Contract hash: ${contractHash}`);
  return { contractHash, packageHash };
}

function deployArgs(packageKeyName: string, base: Record<string, CLValue>): Args {
  return Args.fromMap({
    odra_cfg_package_hash_key_name: CLValue.newCLString(packageKeyName),
    odra_cfg_allow_key_override: CLValue.newCLValueBool(true),
    odra_cfg_is_upgradable: CLValue.newCLValueBool(true),
    odra_cfg_is_upgrade: CLValue.newCLValueBool(false),
    ...base,
  });
}

async function main(): Promise<ContractAddresses> {
  console.log(`
Casper Carbon -- Deployment Script
Deploying to Casper Testnet
  `);

  const deployer = await loadDeployer();
  console.log(`Deployer:   ${deployer.publicKey.toHex()}`);
  console.log(`Network:    ${CONFIG.chainName}`);
  console.log(`RPC:        ${CONFIG.rpcUrl}\n`);

  const handler = new HttpHandler(CONFIG.rpcUrl);
  handler.setCustomHeaders({ Authorization: CONFIG.authToken });
  const rpc = new RpcClient(handler);

  try {
    await rpc.getAccountInfo(undefined, { publicKey: deployer.publicKey });
  } catch (e: any) {
    console.log(`Account ${deployer.publicKey.toHex()} not found on testnet.`);
    console.log(`Fund it with CSPR from https://testnet.cspr.live/tools/faucet\n`);
    process.exit(1);
  }

  const wasmFiles = {
    agentRegistry: path.join(CONFIG.wasmDir, "AgentRegistry.wasm"),
    registry: path.join(CONFIG.wasmDir, "CarbonProjectRegistry.wasm"),
    token: path.join(CONFIG.wasmDir, "CarbonCreditToken.wasm"),
    marketplace: path.join(CONFIG.wasmDir, "CarbonMarketplace.wasm"),
  };

  const PAYMENT = "350000000000"; // 350 CSPR
  const agent = await deployWasm(
    rpc, deployer, wasmFiles.agentRegistry,
    deployArgs("agent_registry", { admin: addressArg(deployer.publicKey) }), PAYMENT,
  );
  const registry = await deployWasm(
    rpc, deployer, wasmFiles.registry,
    deployArgs("carbon_registry", { admin: addressArg(deployer.publicKey) }), PAYMENT,
  );
  const token = await deployWasm(
    rpc, deployer, wasmFiles.token,
    deployArgs("carbon_token", {
      name: CLValue.newCLString("Casper Carbon"),
      symbol: CLValue.newCLString("CARBON"),
      decimals: CLValue.newCLUint8(0),
      registry_contract: contractAddressArg(registry.packageHash),
    }),
    PAYMENT,
  );
  const marketplace = await deployWasm(
    rpc, deployer, wasmFiles.marketplace,
    deployArgs("carbon_marketplace", {
      admin: addressArg(deployer.publicKey),
      token_contract: contractAddressArg(token.packageHash),
    }),
    PAYMENT,
  );

  console.log("\nWire contracts: set_token_contract...");
  const wireHeader = DeployHeader.default();
  wireHeader.account = deployer.publicKey;
  wireHeader.chainName = CONFIG.chainName;
  wireHeader.gasPrice = CONFIG.gasPrice;

  const wireSession = new ExecutableDeployItem();
  wireSession.storedContractByHash = new StoredContractByHash(
    ContractHash.newContract(registry.contractHash),
    "set_token_contract",
    Args.fromMap({ token_contract: contractAddressArg(token.packageHash) }),
  );

  const wireDeploy = Deploy.makeDeploy(
    wireHeader,
    ExecutableDeployItem.standardPayment("5000000000"),
    wireSession,
  );
  wireDeploy.sign(deployer);

  const wireResult: any = await rpc.putDeploy(wireDeploy);
  console.log(`  Wire deploy submitted: ${(wireResult.deployHash || wireResult.hash).toHex()}`);
  const wireInfo: any = await rpc.waitForDeploy(wireDeploy, 300000);
  const wireEr = wireInfo.executionInfo?.executionResult;
  if (wireEr?.errorMessage) throw new Error(`Wire execution failed: ${wireEr.errorMessage}`);
  console.log(`  Wire cost: ${wireEr?.consumed}, Refund: ${wireEr?.refund}`);

  const addresses: ContractAddresses = {
    agentRegistry: agent.contractHash,
    registry: registry.contractHash,
    token: token.contractHash,
    marketplace: marketplace.contractHash,
  };

  const outputPath = path.join(__dirname, "contract-hashes.json");
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log(`\nContract hashes saved to: ${outputPath}`);

  return addresses;
}

main()
  .then(() => { console.log("\nDeployment complete!"); process.exit(0); })
  .catch((err) => { console.error("\nDeployment failed:", err); process.exit(1); });
