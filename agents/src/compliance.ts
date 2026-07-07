import { loadAgentKeypair, callContractEntryPoint, queryContractState, setAgentKeySource } from "./lib/casper.js";
import { detectFraudSignals } from "./lib/llm.js";
import { storeReasoning } from "./lib/reasoning-store.js";
import { config } from "./lib/config.js";
import type { Project } from "./types.js";

async function checkVerifiedProjects(): Promise<void> {
  console.log(`\n[Compliance] Monitoring active/verified projects for fraud signals...`);

  const projectCount = await queryContractState<number>(
    config.REGISTRY_CONTRACT_HASH,
    "next_project_id",
  );

  if (!projectCount) {
    console.log(`[Compliance] No projects found on chain`);
    return;
  }

  for (let id = 0; id < projectCount; id++) {
    const project = await queryContractState<Project>(
      config.REGISTRY_CONTRACT_HASH,
      `projects[${id}]`,
    );

    if (!project) continue;
    if (project.status !== "Active" && project.status !== "Verified") continue;

    console.log(`[Compliance] Checking project #${id}: ${project.name}`);
    const fraudResult = await detectFraudSignals(project.name);

    if (fraudResult.is_fraudulent && fraudResult.confidence > 70) {
      console.log(`[Compliance] ⚠ FRAUD DETECTED for project #${id}!`);
      console.log(`[Compliance] Evidence: ${fraudResult.evidence.join(", ")}`);

      const evidenceHash = storeReasoning(fraudResult);

      try {
        const deployHash = await callContractEntryPoint(
          config.REGISTRY_CONTRACT_HASH,
          "slash_project",
          {
            project_id: id,
            reason_hash: evidenceHash,
          },
          "3000000000",
        );
        console.log(`[Compliance] Slash submitted: ${deployHash}`);
      } catch (err) {
        console.error(`[Compliance] Failed to slash project #${id}:`, err);
      }
    } else {
      console.log(`[Compliance] ✓ Project #${id} appears legitimate (confidence=${fraudResult.confidence})`);
    }
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║     Casper Carbon — Compliance Agent         ║
║   AI-Powered Fraud Detection & Monitoring     ║
╚══════════════════════════════════════════════╝
  `);

  // Sign with the dedicated compliance identity (registered as AgentType::Compliance)
  if (config.COMPLIANCE_PRIVATE_KEY) {
    setAgentKeySource(config.COMPLIANCE_PRIVATE_KEY);
  } else {
    console.warn(`[Compliance] COMPLIANCE_PRIVATE_KEY not set — falling back to AGENT_PRIVATE_KEY (slashing will fail unless that account is registered as Compliance)`);
  }
  const { publicKey } = await loadAgentKeypair();
  console.log(`[Compliance] Agent public key: ${publicKey.toHex()}`);
  console.log(`[Compliance] Poll interval: ${config.POLL_INTERVAL_MS}ms\n`);

  async function poll() {
    try {
      await checkVerifiedProjects();
    } catch (err) {
      console.error(`[Compliance] Poll error:`, err);
    }
  }

  await poll();
  setInterval(poll, config.POLL_INTERVAL_MS);
}

main().catch(console.error);
