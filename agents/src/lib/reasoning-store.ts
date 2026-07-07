import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

// Persists the exact JSON string whose SHA-256 is committed on-chain as
// reasoning_hash, so the web app can prove the AI's reasoning matches the
// on-chain commitment byte-for-byte.
const STORE_DIR = path.resolve(process.cwd(), "..", "web", "public", "reasoning");

export function storeReasoning(payload: unknown): string {
  const json = JSON.stringify(payload);
  const hash = createHash("sha256").update(json).digest("hex");
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STORE_DIR, `${hash}.json`), json);
  } catch (err) {
    console.warn(`[Reasoning] Could not persist artifact ${hash}:`, (err as Error).message);
  }
  return hash;
}
