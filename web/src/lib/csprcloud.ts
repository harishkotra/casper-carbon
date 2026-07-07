// CSPR.cloud REST helpers: agent deploy activity + account hash derivation.
import { blake2b } from "@noble/hashes/blake2.js";

const API = process.env.CSPR_CLOUD_API_URL || "https://api.testnet.cspr.cloud";
const AUTH = process.env.CSPR_CLOUD_AUTH_TOKEN || "";

export const AGENT_KEYS = {
  verifier: process.env.VERIFIER_PUBLIC_KEY || "",
  compliance: process.env.COMPLIANCE_PUBLIC_KEY || "",
};

export function accountHashFromPublicKey(pubKeyHex: string): string {
  const tag = pubKeyHex.slice(0, 2);
  const algo = tag === "01" ? "ed25519" : "secp256k1";
  const keyBytes = Buffer.from(pubKeyHex.slice(2), "hex");
  const preimage = Buffer.concat([Buffer.from(algo, "ascii"), Buffer.from([0]), keyBytes]);
  return Buffer.from(blake2b(preimage, { dkLen: 32 })).toString("hex");
}

export interface AgentDeploy {
  deploy_hash: string;
  timestamp: string;
  entry_point: string;
  contract_hash: string;
  args: Record<string, unknown>;
  error_message: string | null;
  cost: string;
  agent: "verifier" | "compliance";
  block_height: number;
}

interface RawDeploy {
  deploy_hash: string;
  timestamp: string;
  contract_hash: string | null;
  contract_entrypoint?: { name: string } | null;
  args: Record<string, { parsed: unknown }> | null;
  error_message: string | null;
  cost: string;
  block_height: number;
  execution_type_id: number;
}

async function fetchAccountDeploys(publicKey: string, agent: "verifier" | "compliance"): Promise<AgentDeploy[]> {
  if (!publicKey) return [];
  const url = `${API}/accounts/${publicKey}/deploys?page_size=100&includes=contract_entrypoint`;
  const res = await fetch(url, { headers: { Authorization: AUTH }, cache: "no-store" });
  if (!res.ok) throw new Error(`CSPR.cloud ${res.status} for ${url}`);
  const data = await res.json();
  return (data.data as RawDeploy[]).map((d) => ({
    deploy_hash: d.deploy_hash,
    timestamp: d.timestamp,
    entry_point: d.contract_entrypoint?.name ?? (d.execution_type_id === 6 ? "transfer" : "unknown"),
    contract_hash: d.contract_hash ?? "",
    args: Object.fromEntries(Object.entries(d.args ?? {}).map(([k, v]) => [k, v?.parsed])),
    error_message: d.error_message,
    cost: d.cost,
    agent,
    block_height: d.block_height,
  }));
}

export async function getAgentActivity(): Promise<AgentDeploy[]> {
  const [verifier, compliance] = await Promise.all([
    fetchAccountDeploys(AGENT_KEYS.verifier, "verifier"),
    fetchAccountDeploys(AGENT_KEYS.compliance, "compliance"),
  ]);
  return [...verifier, ...compliance].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}
