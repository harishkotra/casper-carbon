/* eslint-disable prefer-const, @typescript-eslint/no-explicit-any */
// Server-side read layer for Casper testnet state (no casper-js-sdk needed).
// Mirrors agents/src/lib/casper.ts: Odra 2.8 stores all contract state in a
// "state" dictionary; keys are blake2b256(field_index_be4 ++ mapping_key_bytes)
// hex-encoded, with field indices starting at 1.
import { blake2b } from "@noble/hashes/blake2.js";

const RPC_URL = process.env.CASPER_RPC_URL!;
const AUTH = process.env.CSPR_CLOUD_AUTH_TOKEN || "";

export const CONTRACTS = {
  registry: process.env.REGISTRY_CONTRACT_HASH!,
  marketplace: process.env.MARKETPLACE_CONTRACT_HASH!,
  agentRegistry: process.env.AGENT_REGISTRY_HASH!,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc(method: string, params: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // CSPR.cloud rate limiting returns a plain-text "access limited" body
      if (attempt < 4) { await sleep(400 * (attempt + 1)); continue; }
      throw new Error(`RPC rate-limited: ${text.slice(0, 80)}`);
    }
    if (data.error) throw new RpcError(data.error);
    return data.result;
  }
}

class RpcError extends Error {
  code: number;
  data?: string;
  constructor(err: { code: number; message: string; data?: string }) {
    super(err.message);
    this.code = err.code;
    this.data = err.data;
  }
}

const stateUrefCache = new Map<string, string>();

async function getStateUref(contractHash: string): Promise<string> {
  const cached = stateUrefCache.get(contractHash);
  if (cached) return cached;
  const result = await rpc("query_global_state", {
    state_identifier: null,
    key: `hash-${contractHash}`,
    path: [],
  });
  const namedKeys: { name: string; key: string }[] =
    result?.stored_value?.Contract?.named_keys ?? [];
  const state = namedKeys.find((k) => k.name === "state");
  if (!state) throw new Error(`No 'state' named key for ${contractHash}`);
  stateUrefCache.set(contractHash, state.key);
  return state.key;
}

function odraKey(fieldIndex: number, mapKeyBytes?: Uint8Array): string {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, fieldIndex, false);
  const input = mapKeyBytes
    ? Buffer.concat([Buffer.from(idx), Buffer.from(mapKeyBytes)])
    : Buffer.from(idx);
  return Buffer.from(blake2b(input, { dkLen: 32 })).toString("hex");
}

// State root cached briefly: every dictionary read in a request batch shares it
let rootCache: { root: string; at: number } | null = null;
async function getStateRoot(): Promise<string> {
  if (rootCache && Date.now() - rootCache.at < 8000) return rootCache.root;
  const root = (await rpc("chain_get_state_root_hash", {})).state_root_hash;
  rootCache = { root, at: Date.now() };
  return root;
}

async function queryDict(contractHash: string, dictKey: string): Promise<Uint8Array | null> {
  const seedUref = await getStateUref(contractHash);
  const root = await getStateRoot();
  try {
    const result = await rpc("state_get_dictionary_item", {
      state_root_hash: root,
      dictionary_identifier: { URef: { seed_uref: seedUref, dictionary_item_key: dictKey } },
    });
    const bytes: number[] = result?.stored_value?.CLValue?.parsed ?? [];
    return new Uint8Array(bytes);
  } catch (e) {
    if (e instanceof RpcError && (e.data?.includes("not found") || e.message.includes("not found"))) {
      return null;
    }
    throw e;
  }
}

// --- bytesrepr readers ---
function readU32LE(buf: Uint8Array, o: number): [number, number] {
  return [(buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0, o + 4];
}
function readString(buf: Uint8Array, o: number): [string, number] {
  const [len, p] = readU32LE(buf, o);
  return [Buffer.from(buf.slice(p, p + len)).toString("utf-8"), p + len];
}
function readU256(buf: Uint8Array, o: number): [string, number] {
  const len = buf[o];
  const hex = Buffer.from(buf.slice(o + 1, o + 1 + len).slice().reverse()).toString("hex");
  return [BigInt(`0x${hex || "0"}`).toString(), o + 1 + len];
}
function readU64LE(buf: Uint8Array, o: number): [number, number] {
  return [Number(Buffer.from(buf.slice(o, o + 8)).readBigUInt64LE()), o + 8];
}

export interface ChainProject {
  id: number;
  name: string;
  metadata_hash: string;
  location: string;
  verifier: string;
  status: "Pending" | "Verified" | "Active" | "Slashed";
  verification_score: number;
  total_credit_supply: string;
  minted_supply: string;
  created_at: number;
  verified_at: number | null;
  reasoning_hash: string;
}

export interface ChainListing {
  id: number;
  seller: string;
  project_id: number;
  amount: string;
  price_per_token: string;
  active: boolean;
}

export interface ChainAgent {
  address: string;
  name: string;
  agent_type: "Verifier" | "Market" | "Compliance";
  reputation_score: number;
  total_verifications: number;
  successful_verifications: number;
  is_active: boolean;
}

const STATUSES = ["Pending", "Verified", "Active", "Slashed"] as const;
const AGENT_TYPES = ["Verifier", "Market", "Compliance"] as const;

function decodeProject(raw: Uint8Array): ChainProject {
  let o = 0;
  let id: number, name: string, metadata_hash: string, location: string;
  [id, o] = readU32LE(raw, o);
  [name, o] = readString(raw, o);
  [metadata_hash, o] = readString(raw, o);
  [location, o] = readString(raw, o);
  const verifier = Buffer.from(raw.slice(o + 1, o + 33)).toString("hex");
  o += 33;
  const status = STATUSES[raw[o]] ?? "Slashed"; o += 1;
  const verification_score = raw[o]; o += 1;
  let total_credit_supply: string, minted_supply: string, created_at: number;
  [total_credit_supply, o] = readU256(raw, o);
  [minted_supply, o] = readU256(raw, o);
  [created_at, o] = readU64LE(raw, o);
  const hasVerifiedAt = raw[o]; o += 1;
  let verified_at: number | null = null;
  if (hasVerifiedAt) [verified_at, o] = readU64LE(raw, o);
  const [reasoning_hash] = readString(raw, o);
  return {
    id, name, metadata_hash, location, verifier, status, verification_score,
    total_credit_supply, minted_supply, created_at, verified_at, reasoning_hash,
  };
}

function decodeListing(raw: Uint8Array): ChainListing {
  let o = 0;
  let id: number, project_id: number, amount: string, price_per_token: string;
  [id, o] = readU32LE(raw, o);
  const seller = Buffer.from(raw.slice(o + 1, o + 33)).toString("hex");
  o += 33;
  [project_id, o] = readU32LE(raw, o);
  [amount, o] = readU256(raw, o);
  [price_per_token, o] = readU256(raw, o);
  return { id, seller, project_id, amount, price_per_token, active: raw[o] === 1 };
}

function decodeAgent(raw: Uint8Array): ChainAgent {
  let o = 0;
  const address = Buffer.from(raw.slice(o + 1, o + 33)).toString("hex");
  o += 33;
  let name: string, reputation_score: number, total: number, success: number;
  [name, o] = readString(raw, o);
  const agent_type = AGENT_TYPES[raw[o]] ?? "Verifier"; o += 1;
  [reputation_score, o] = readU32LE(raw, o);
  [total, o] = readU32LE(raw, o);
  [success, o] = readU32LE(raw, o);
  return {
    address, name, agent_type, reputation_score,
    total_verifications: total, successful_verifications: success,
    is_active: raw[o] === 1,
  };
}

// Field indices (1-based, declaration order in the Odra module structs)
const REGISTRY = { projects: 1, next_project_id: 2 };
const MARKETPLACE = { listings: 1, next_listing_id: 2 };
const AGENT_REGISTRY = { agents: 1, agent_count: 2 };

async function readVarU32(contractHash: string, fieldIndex: number): Promise<number> {
  const raw = await queryDict(contractHash, odraKey(fieldIndex));
  if (!raw || raw.length === 0) return 0;
  return readU32LE(raw, 0)[0];
}

function u32Bytes(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

// Short-lived response cache so UI polling doesn't hammer the rate-limited node
const responseCache = new Map<string, { data: unknown; at: number }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await fn();
  responseCache.set(key, { data, at: Date.now() });
  return data;
}

export async function getProjects(): Promise<ChainProject[]> {
  return cached("projects", 8000, async () => {
    const count = await readVarU32(CONTRACTS.registry, REGISTRY.next_project_id);
    const projects: ChainProject[] = [];
    for (let id = 0; id < count; id++) {
      const raw = await queryDict(CONTRACTS.registry, odraKey(REGISTRY.projects, u32Bytes(id)));
      if (raw && raw.length) projects.push(decodeProject(raw));
    }
    return projects;
  });
}

export async function getListings(): Promise<ChainListing[]> {
  return cached("listings", 8000, async () => {
    const count = await readVarU32(CONTRACTS.marketplace, MARKETPLACE.next_listing_id);
    const listings: ChainListing[] = [];
    for (let id = 0; id < count; id++) {
      const raw = await queryDict(CONTRACTS.marketplace, odraKey(MARKETPLACE.listings, u32Bytes(id)));
      if (raw && raw.length) listings.push(decodeListing(raw));
    }
    return listings;
  });
}

// Agents mapping is keyed by Address (tag 0x00 + 32-byte account hash)
export async function getAgent(accountHash: string): Promise<ChainAgent | null> {
  return cached(`agent:${accountHash}`, 15000, async () => {
    const addr = Buffer.concat([Buffer.from([0]), Buffer.from(accountHash, "hex")]);
    const raw = await queryDict(CONTRACTS.agentRegistry, odraKey(AGENT_REGISTRY.agents, addr));
    return raw && raw.length ? decodeAgent(raw) : null;
  });
}
