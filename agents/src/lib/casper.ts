import * as fs from "fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { config } from "./config.js";
import type { RpcClient, PrivateKey, PublicKey } from "casper-js-sdk";
import CasperSDK from "casper-js-sdk";
const {
  HttpHandler, RpcClient: RpcClientCtor, PrivateKey: PrivateKeyCtor,
  PublicKey: PublicKeyCtor, KeyAlgorithm, Args, CLValue,
  Deploy, DeployHeader, ExecutableDeployItem, StoredContractByHash,
  ContractHash, TransferDeployItem, Key,
} = CasperSDK as any;

export function publicKeyToCLKey(pubKey: PublicKey): any {
  return CLValue.newCLKey(Key.newKey(pubKey.accountHash().toPrefixedString()));
}

let rpcClient: RpcClient | null = null;
let agentKey: PrivateKey | null = null;
let agentPubKey: PublicKey | null = null;

export function getRpcClient(): RpcClient {
  if (!rpcClient) {
    const handler = new HttpHandler(config.CASPER_RPC_URL);
    if (config.CSPR_CLOUD_AUTH_TOKEN) {
      handler.setCustomHeaders({ Authorization: config.CSPR_CLOUD_AUTH_TOKEN });
    }
    rpcClient = new RpcClientCtor(handler);
  }
  return rpcClient!;
}

// Which key this process signs with. Defaults to the main agent key;
// the compliance agent switches to its own registered identity at startup.
let keySource = config.AGENT_PRIVATE_KEY;

export function setAgentKeySource(source: string): void {
  if (!source) throw new Error("setAgentKeySource: empty key source");
  keySource = source;
  agentKey = null;
  agentPubKey = null;
}

export async function loadAgentKeypair(): Promise<{
  privateKey: PrivateKey;
  publicKey: PublicKey;
}> {
  if (agentKey && agentPubKey) {
    return { privateKey: agentKey, publicKey: agentPubKey };
  }

  if (keySource) {
    if (keySource.includes("/") || keySource.startsWith(".")) {
      const pem = fs.readFileSync(keySource, "utf-8");
      if (pem.startsWith("-----BEGIN EC PRIVATE KEY-----")) {
        agentKey = await parseSec1Pem(pem);
      } else {
        const algo = pem.includes("PRIVATE KEY") ? KeyAlgorithm.ED25519 : KeyAlgorithm.ED25519;
        agentKey = await PrivateKeyCtor.fromPem(pem, algo);
      }
    } else {
      const algo =
        keySource.length === 64
          ? KeyAlgorithm.ED25519
          : KeyAlgorithm.SECP256K1;
      agentKey = await PrivateKeyCtor.fromHex(keySource, algo);
    }
  } else {
    agentKey = await PrivateKeyCtor.generate(KeyAlgorithm.ED25519);
  }

  agentPubKey = agentKey!.publicKey;
  return { privateKey: agentKey!, publicKey: agentPubKey };
}

function parseSec1Pem(pem: string): PrivateKey {
  const b64 = pem.replace(/-----.*?-----/g, "").replace(/\s/g, "");
  const der = new Uint8Array(Buffer.from(b64, "base64"));
  const marker = new Uint8Array([0x04, 0x20]);
  let idx = -1;
  for (let i = 0; i < der.length - 1; i++) {
    if (der[i] === marker[0] && der[i + 1] === marker[1]) {
      idx = i + 2;
      break;
    }
  }
  if (idx < 0) throw new Error("Could not find private key seed in SEC1 PEM");
  const seed = Buffer.from(der.slice(idx, idx + 32)).toString("hex");
  const oidMarker = new Uint8Array([0x06, 0x05]);
  let oidStart = -1;
  for (let i = 0; i < der.length - 6; i++) {
    if (der[i] === 0x06 && der[i + 1] === 0x05) { oidStart = i + 2; break; }
  }
  const algorithm = oidStart >= 0 && der[oidStart] === 0x2b
    ? KeyAlgorithm.SECP256K1
    : KeyAlgorithm.ED25519;
  return PrivateKeyCtor.fromHex(seed, algorithm);
}

// --- Odra storage key derivation ---
// Odra 2.8 assigns field indices starting at 1 (not 0).
// Key = blake2b256(index_bytes + mapping_data) as 64-char hex string.
// index_bytes for top-level field n (n<=15): n.to_be_bytes(4)

function odraVarKey(fieldIndex: number): string {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(fieldIndex, 0);
  const hash = blake2b(buf, { dkLen: 32 });
  return Buffer.from(hash).toString("hex");
}

function odraMappingKey(fieldIndex: number, mapKeyBytes: Buffer): string {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(fieldIndex, 0);
  const combined = Buffer.concat([indexBuf, mapKeyBytes]);
  const hash = blake2b(combined, { dkLen: 32 });
  return Buffer.from(hash).toString("hex");
}

// Get the `state` dictionary URef for a contract (cached per hash)
const stateUrefCache = new Map<string, string>();

async function getStateUref(contractHash: string): Promise<string> {
  const bare = contractHash.replace(/^hash-/, "");
  const cached = stateUrefCache.get(bare);
  if (cached) return cached;

  const rpcUrl = config.CASPER_RPC_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.CSPR_CLOUD_AUTH_TOKEN) headers["Authorization"] = config.CSPR_CLOUD_AUTH_TOKEN;

  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "query_global_state",
      params: { state_identifier: null, key: `hash-${bare}`, path: [] },
    }),
  });
  const data: any = await resp.json();
  if (data?.error) throw new Error(`query_global_state failed for ${bare}: ${JSON.stringify(data.error)}`);
  const namedKeys: any[] = data?.result?.stored_value?.Contract?.named_keys ?? [];
  const stateKey = namedKeys.find((k: any) => k.name === "state");
  if (!stateKey) throw new Error(`No 'state' named key for contract ${bare}`);
  stateUrefCache.set(bare, stateKey.key);
  return stateKey.key as string;
}

// Entry point signatures (name -> arg name -> cl_type), cached per contract
const entryPointCache = new Map<string, Map<string, Map<string, any>>>();

async function getEntryPointArgTypes(
  contractHash: string,
  entryPoint: string,
): Promise<Map<string, any>> {
  const bare = contractHash.replace(/^hash-/, "");
  let contractEps = entryPointCache.get(bare);
  if (!contractEps) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.CSPR_CLOUD_AUTH_TOKEN) headers["Authorization"] = config.CSPR_CLOUD_AUTH_TOKEN;
    const resp = await fetch(config.CASPER_RPC_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "query_global_state",
        params: { state_identifier: null, key: `hash-${bare}`, path: [] },
      }),
    });
    const data: any = await resp.json();
    if (data?.error) throw new Error(`query_global_state failed for ${bare}: ${JSON.stringify(data.error)}`);
    const eps: any[] = data?.result?.stored_value?.Contract?.entry_points ?? [];
    contractEps = new Map();
    for (const ep of eps) {
      const argMap = new Map<string, any>();
      for (const a of ep.args ?? []) argMap.set(a.name, a.cl_type);
      contractEps.set(ep.name, argMap);
    }
    entryPointCache.set(bare, contractEps);
  }
  const args = contractEps.get(entryPoint);
  if (!args) throw new Error(`Entry point '${entryPoint}' not found on contract ${bare}`);
  return args;
}

async function queryDict(seedUref: string, dictKey: string): Promise<Uint8Array | null> {
  const rpcUrl = config.CASPER_RPC_URL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.CSPR_CLOUD_AUTH_TOKEN) headers["Authorization"] = config.CSPR_CLOUD_AUTH_TOKEN;

  // Get current state root
  const rootResp = await fetch(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "chain_get_state_root_hash", params: {} }),
  });
  const rootData: any = await rootResp.json();
  const stateRoot: string = rootData?.result?.state_root_hash;

  const resp = await fetch(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "state_get_dictionary_item",
      params: {
        state_root_hash: stateRoot,
        dictionary_identifier: {
          URef: { seed_uref: seedUref, dictionary_item_key: dictKey },
        },
      },
    }),
  });
  const data: any = await resp.json();
  if (data?.error) {
    if (data.error.data?.includes("not found") || data.error.message?.includes("not found")) return null;
    throw new Error(`Dict query failed: ${JSON.stringify(data.error)}`);
  }
  // CLValue is List<U8> — the raw Casper bytesrepr bytes, prefixed with 4-byte length
  const clBytes: number[] = data?.result?.stored_value?.CLValue?.parsed ?? [];
  return new Uint8Array(clBytes);
}

// --- Casper bytesrepr deserializers ---

function readU32LE(buf: Uint8Array, offset: number): [number, number] {
  const v = buf[offset] | (buf[offset+1] << 8) | (buf[offset+2] << 16) | (buf[offset+3] << 24);
  return [v >>> 0, offset + 4];
}

function readString(buf: Uint8Array, offset: number): [string, number] {
  const [len, o] = readU32LE(buf, offset);
  const str = Buffer.from(buf.slice(o, o + len)).toString("utf-8");
  return [str, o + len];
}

function decodeU32(raw: Uint8Array): number {
  const [v] = readU32LE(raw, 0);
  return v;
}

// Casper bytesrepr for U256/U512: 1 length byte, then `length` little-endian bytes
function readU256(buf: Uint8Array, offset: number): [string, number] {
  const len = buf[offset];
  const bytes = buf.slice(offset + 1, offset + 1 + len);
  const hex = Buffer.from(bytes.slice().reverse()).toString("hex");
  return [BigInt(`0x${hex || "0"}`).toString(), offset + 1 + len];
}

function decodeProjectStatus(discriminant: number): "Pending" | "Verified" | "Active" | "Slashed" {
  switch (discriminant) {
    case 0: return "Pending";
    case 1: return "Verified";
    case 2: return "Active";
    default: return "Slashed";
  }
}

function decodeProject(raw: Uint8Array): any {
  let o = 0;
  let id: number, name: string, metadataHash: string, location: string;
  [id, o] = readU32LE(raw, o);
  [name, o] = readString(raw, o);
  [metadataHash, o] = readString(raw, o);
  [location, o] = readString(raw, o);
  // verifier: Address = 1 byte tag + 32 bytes
  const verifier = Buffer.from(raw.slice(o + 1, o + 33)).toString("hex");
  o += 33;
  const statusByte = raw[o]; o += 1;
  const status = decodeProjectStatus(statusByte);
  const score = raw[o]; o += 1;
  let supply: string, minted: string;
  [supply, o] = readU256(raw, o);
  [minted, o] = readU256(raw, o);
  const createdAt = Number(Buffer.from(raw.slice(o, o + 8)).readBigUInt64LE()); o += 8;
  // Option<u64>: 1 byte tag
  const hasVerifiedAt = raw[o]; o += 1;
  const verifiedAt = hasVerifiedAt ? Number(Buffer.from(raw.slice(o, o + 8)).readBigUInt64LE()) : null;
  if (hasVerifiedAt) o += 8;
  let reasoningHash: string;
  [reasoningHash, o] = readString(raw, o);

  return {
    id, name, metadata_hash: metadataHash, location, verifier,
    status, verification_score: score,
    total_credit_supply: supply,
    minted_supply: minted,
    created_at: createdAt, verified_at: verifiedAt, reasoning_hash: reasoningHash,
  };
}

function decodeListing(raw: Uint8Array): any {
  let o = 0;
  let id: number, projectId: number, amount: string, price: string;
  [id, o] = readU32LE(raw, o);
  const seller = Buffer.from(raw.slice(o + 1, o + 33)).toString("hex");
  o += 33; // seller: Address = 1 tag byte + 32 bytes
  [projectId, o] = readU32LE(raw, o);
  [amount, o] = readU256(raw, o);
  [price, o] = readU256(raw, o);
  const active = raw[o] === 1;

  return { id, seller, project_id: projectId, amount, price_per_token: price, active };
}

// CONTRACT_FIELD_INDICES maps (contractHash -> fieldName -> fieldIndex)
// These are 1-based indices from the Odra proc macro (idx = enumeration_index + 1)
const REGISTRY_FIELDS: Record<string, number> = {
  projects: 1,
  next_project_id: 2,
  agent_registry: 3,
  token_contract: 4,
  admin: 5,
};

const MARKETPLACE_FIELDS: Record<string, number> = {
  listings: 1,
  next_listing_id: 2,
  token_contract: 3,
  fee_percentage: 4,
  admin: 5,
};

function getFieldIndex(contractHash: string, fieldName: string): number | null {
  const bare = contractHash.replace(/^hash-/, "");
  if (bare === config.REGISTRY_CONTRACT_HASH) {
    return REGISTRY_FIELDS[fieldName] ?? null;
  }
  if (bare === config.MARKETPLACE_CONTRACT_HASH) {
    return MARKETPLACE_FIELDS[fieldName] ?? null;
  }
  return null;
}

export async function queryContractState<T>(
  contractHash: string,
  keySpec: string,
): Promise<T | null> {
  const bare = contractHash.replace(/^hash-/, "");
  const seedUref = await getStateUref(bare);

  // keySpec format: "fieldName" for Var, "fieldName[u32]" for Mapping<u32,V>
  let dictKey: string;
  const mappingMatch = keySpec.match(/^(\w+)\[(\d+)\]$/);

  if (mappingMatch) {
    const [, fieldName, keyStr] = mappingMatch;
    const fieldIdx = getFieldIndex(bare, fieldName);
    if (fieldIdx === null) throw new Error(`Unknown field '${fieldName}' for contract ${bare}`);
    const mapKeyBuf = Buffer.alloc(4);
    mapKeyBuf.writeUInt32LE(parseInt(keyStr), 0);
    dictKey = odraMappingKey(fieldIdx, mapKeyBuf);
  } else {
    const fieldIdx = getFieldIndex(bare, keySpec);
    if (fieldIdx === null) throw new Error(`Unknown field '${keySpec}' for contract ${bare}`);
    dictKey = odraVarKey(fieldIdx);
  }

  const raw = await queryDict(seedUref, dictKey);
  if (!raw || raw.length === 0) return null;

  // Deserialize based on the field type
  if (keySpec === "next_project_id" || keySpec === "next_listing_id") {
    return decodeU32(raw) as unknown as T;
  }
  if (keySpec.startsWith("projects[")) {
    return decodeProject(raw) as unknown as T;
  }
  if (keySpec.startsWith("listings[")) {
    return decodeListing(raw) as unknown as T;
  }

  // Generic: return the raw bytes as hex string for caller to handle
  return Buffer.from(raw).toString("hex") as unknown as T;
}

export async function callContractEntryPoint(
  contractHash: string,
  entryPoint: string,
  callArgs: Record<string, unknown>,
  paymentAmount: string,
): Promise<string> {
  const { privateKey } = await loadAgentKeypair();
  const client = getRpcClient();

  const deploy = await buildContractDeploy(contractHash, entryPoint, callArgs, paymentAmount);
  deploy.sign(privateKey);

  const result: any = await (client as any).putDeploy(deploy);
  const deployHashHex = (result.deployHash || result.hash)?.toHex?.() || result.deploy_hash;
  if (!deployHashHex) throw new Error("putDeploy returned no deploy hash");

  // Wait for execution and check for errors
  try {
    const execInfo: any = await client.waitForDeploy(deploy, 120000);
    const er = execInfo?.executionInfo?.executionResult;
    const errMsg = er?.errorMessage || er?.Failure?.errorMessage;
    if (errMsg) throw new Error(`On-chain execution failed: ${errMsg}`);
  } catch (waitErr: any) {
    // If waitForDeploy itself errors (timeout, etc.) log but don't throw
    if (waitErr?.message?.includes("execution failed")) throw waitErr;
    console.warn(`[Casper] waitForDeploy warning: ${waitErr?.message}`);
  }

  console.log(`[Casper] ⛓  https://testnet.cspr.live/deploy/${deployHashHex}`);
  return deployHashHex;
}

// Builds an unsigned deploy with CLValues typed from the entry point's
// on-chain declared cl_types. Exported so tests can validate deploy
// construction without submitting.
export async function buildContractDeploy(
  contractHash: string,
  entryPoint: string,
  callArgs: Record<string, unknown>,
  paymentAmount: string,
): Promise<any> {
  const { publicKey } = await loadAgentKeypair();

  const argTypes = await getEntryPointArgTypes(contractHash, entryPoint);
  const clArgs: Record<string, any> = {};
  for (const [key, val] of Object.entries(callArgs)) {
    const clType = argTypes.get(key);
    const sval = String(val);
    switch (clType) {
      case "U8":
        clArgs[key] = CLValue.newCLUint8(Number(sval)); break;
      case "U32":
        clArgs[key] = CLValue.newCLUInt32(Number(sval)); break;
      case "U64":
        clArgs[key] = CLValue.newCLUint64(sval); break;
      case "U256":
        clArgs[key] = CLValue.newCLUInt256(sval); break;
      case "U512":
        clArgs[key] = CLValue.newCLUInt512(sval); break;
      case "String":
        clArgs[key] = CLValue.newCLString(sval); break;
      case "Bool":
        clArgs[key] = CLValue.newCLValueBool(Boolean(val)); break;
      case "Key":
        clArgs[key] = CLValue.newCLKey(Key.newKey(sval)); break;
      case undefined:
        throw new Error(`Arg '${key}' not declared on entry point '${entryPoint}'`);
      default:
        throw new Error(`Unsupported cl_type ${JSON.stringify(clType)} for arg '${key}'`);
    }
  }

  const header = DeployHeader.default();
  header.account = publicKey;
  header.chainName = config.CASPER_CHAIN_NAME;
  header.gasPrice = 1;

  const session = new ExecutableDeployItem();
  session.storedContractByHash = new StoredContractByHash(
    ContractHash.newContract(contractHash),
    entryPoint,
    Args.fromMap(clArgs),
  );

  const payment = ExecutableDeployItem.standardPayment(paymentAmount);

  return Deploy.makeDeploy(header, payment, session);
}

export async function sendTransfer(
  recipient: string,
  amountMotes: string,
): Promise<string> {
  const { privateKey, publicKey } = await loadAgentKeypair();
  const client = getRpcClient();

  const recipientKey = PublicKeyCtor.fromHex(recipient);

  const header = DeployHeader.default();
  header.account = publicKey;
  header.chainName = config.CASPER_CHAIN_NAME;
  header.gasPrice = 1;

  // Native transfer as Deploy v1.0 (same format accepted by testnet)
  const transferItem = TransferDeployItem.newTransfer(amountMotes, recipientKey, null, Date.now());
  const session = new ExecutableDeployItem();
  session.transfer = transferItem;
  const payment = ExecutableDeployItem.standardPayment("100000000");

  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);

  const result: any = await (client as any).putDeploy(deploy);
  const deployHash = (result.deployHash || result.hash)?.toHex?.() || result.deploy_hash;
  if (!deployHash) throw new Error("putDeploy returned no deploy hash");
  console.log(`[Casper] ⛓  https://testnet.cspr.live/deploy/${deployHash}`);
  return deployHash;
}

export async function getAccountBalance(address: string): Promise<string> {
  const client = getRpcClient();
  try {
    const balance = await (client as any).queryLatestBalance(address);
    return balance?.toString() ?? "0";
  } catch {
    return "0";
  }
}
