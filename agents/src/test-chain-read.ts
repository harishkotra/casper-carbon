// Integration test: verifies Odra state-key derivation and struct decoding
// against the live Casper testnet. Read-only — sends no deploys.
import { queryContractState, buildContractDeploy, loadAgentKeypair } from "./lib/casper.js";
import { config } from "./lib/config.js";
import type { Project, Listing } from "./types.js";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

async function main() {
  console.log("— Registry —");
  const projectCount = await queryContractState<number>(
    config.REGISTRY_CONTRACT_HASH,
    "next_project_id",
  );
  check(typeof projectCount === "number" && projectCount! > 0, `next_project_id = ${projectCount}`);

  for (let id = 0; id < (projectCount ?? 0); id++) {
    const p = await queryContractState<Project>(
      config.REGISTRY_CONTRACT_HASH,
      `projects[${id}]`,
    );
    if (!p) { check(false, `projects[${id}] missing`); continue; }
    const nameOk = typeof p.name === "string" && p.name.length > 0 && /^[\x20-\x7E]+$/.test(p.name);
    const statusOk = ["Pending", "Verified", "Active", "Slashed"].includes(p.status as string);
    const idOk = (p as any).id === id;
    check(nameOk && statusOk && idOk,
      `projects[${id}]: id=${(p as any).id} name="${p.name}" status=${p.status} score=${p.verification_score} supply=${p.total_credit_supply}`);
  }

  console.log("\n— Marketplace —");
  const listingCount = await queryContractState<number>(
    config.MARKETPLACE_CONTRACT_HASH,
    "next_listing_id",
  );
  check(typeof listingCount === "number", `next_listing_id = ${listingCount}`);

  for (let id = 0; id < (listingCount ?? 0); id++) {
    const l = await queryContractState<Listing>(
      config.MARKETPLACE_CONTRACT_HASH,
      `listings[${id}]`,
    );
    if (!l) { check(false, `listings[${id}] missing`); continue; }
    check((l as any).id === id && typeof l.active === "boolean",
      `listings[${id}]: project=${l.project_id} amount=${l.amount} price=${l.price_per_token} active=${l.active}`);
  }

  // Deploy construction (signed but never submitted) — validates that args
  // are built from the entry points' on-chain declared cl_types.
  console.log("\n— Deploy construction (offline) —");
  const { privateKey } = await loadAgentKeypair();
  const deployCases: Array<[string, string, Record<string, unknown>]> = [
    [config.REGISTRY_CONTRACT_HASH, "verify_project", { project_id: "0", score: "85", credit_supply: "50000", reasoning_hash: "abc123" }],
    [config.REGISTRY_CONTRACT_HASH, "activate_project", { project_id: "0" }],
    [config.REGISTRY_CONTRACT_HASH, "slash_project", { project_id: "0", reason_hash: "deadbeef" }],
    [config.MARKETPLACE_CONTRACT_HASH, "list", { project_id: "0", amount: "50000", price_per_token: "15000000000" }],
    [config.MARKETPLACE_CONTRACT_HASH, "cancel_listing", { listing_id: "0" }],
  ];
  for (const [hash, ep, args] of deployCases) {
    try {
      const deploy = await buildContractDeploy(hash, ep, args, "5000000000");
      deploy.sign(privateKey);
      const dh = deploy.hash?.toHex?.() ?? "signed";
      check(!!dh, `${ep}(${Object.keys(args).join(", ")}) builds & signs → ${dh}`);
    } catch (e: any) {
      check(false, `${ep} failed to build: ${e.message}`);
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
