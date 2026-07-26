import { verifyCarbonProject } from "./lib/llm.js";
import { loadAgentKeypair, callContractEntryPoint, queryContractState } from "./lib/casper.js";
import { config } from "./lib/config.js";
import { fetchProjectByKey, searchProjectsByName, fetchCarbonPrice } from "./lib/carbonmark.js";
import { fetchCsprUsdPrice } from "./lib/price.js";
import { storeReasoning } from "./lib/reasoning-store.js";
import type { Project, CarbonData, VerificationResult } from "./types.js";

// Persists the reasoning artifact for the web UI and returns its SHA-256,
// which is committed on-chain as reasoning_hash.
function generateReasoningHash(result: VerificationResult): string {
  return storeReasoning(result);
}

async function fetchCarbonProjectData(projectId: number): Promise<CarbonData | null> {
  if (config.CARBON_PROJECT_KEY) {
    return await fetchProjectByKey(config.CARBON_PROJECT_KEY);
  }
  const project = await queryContractState(
    config.REGISTRY_CONTRACT_HASH,
    `projects[${projectId}]`,
  ) as Project | null;
  if (!project || !project.name) {
    console.log(`[Verifier] No project data on chain for #${projectId}`);
    return null;
  }
  const matches = await searchProjectsByName(project.name);
  if (matches.length === 0) {
    console.log(`[Verifier] No Carbonmark match for "${project.name}"`);
    return null;
  }
  return await fetchProjectByKey(matches[0].key);
}

async function checkPendingProjects(): Promise<number[]> {
  const projectCount = await queryContractState(
    config.REGISTRY_CONTRACT_HASH,
    "next_project_id",
  ) as number | null;
  if (!projectCount) {
    console.log(`[Verifier] next_project_id not found on chain`);
    return [];
  }
  console.log(`[Verifier] Total projects on chain: ${projectCount}`);

  const pendingIds: number[] = [];
  for (let id = 0; id < projectCount; id++) {
    const project = await queryContractState(
      config.REGISTRY_CONTRACT_HASH,
      `projects[${id}]`,
    ) as Project | null;
    if (project && project.status === "Pending") {
      pendingIds.push(id);
    }
  }
  return pendingIds;
}

async function submitVerification(
  projectId: number,
  result: VerificationResult,
  supply: string,
) {
  const reasoningHash = generateReasoningHash(result);
  console.log(`\n[Verifier] Submitting verification for project #${projectId}:`);
  console.log(`  Score: ${result.score}/100`);
  console.log(`  Confidence: ${result.confidence}`);
  console.log(`  Supply: ${supply} tonnes`);
  console.log(`  Reasoning: ${result.reasoning.slice(0, 200)}...`);

  const deployHash = await callContractEntryPoint(
    config.REGISTRY_CONTRACT_HASH,
    "verify_project",
    {
      project_id: projectId.toString(),
      score: result.score.toString(),
      credit_supply: String(supply),
      reasoning_hash: String(reasoningHash),
    },
    "50000000000",
  );
    console.log(`[Verifier] Verification confirmed: ${deployHash}`);

  try {
    const activateHash = await callContractEntryPoint(
      config.REGISTRY_CONTRACT_HASH,
      "activate_project",
      { project_id: projectId.toString() },
      "5000000000",
    );
    console.log(`[Verifier] Project activated: ${activateHash}`);
  } catch (err) {
    console.warn(`[Verifier] activate_project failed (may already be active):`, err);
  }

  if (config.TOKEN_CONTRACT_HASH && config.MARKETPLACE_CONTRACT_HASH) {
    try {
      const approveHash = await callContractEntryPoint(
        config.TOKEN_CONTRACT_HASH,
        "approve",
        {
          spender: `hash-${config.MARKETPLACE_CONTRACT_HASH}`,
          amount: String(supply),
        },
        "5000000000",
      );
      console.log(`[Verifier] Marketplace approved to spend ${supply} CARBON: ${approveHash}`);
    } catch (err) {
      console.warn(`[Verifier] approve failed:`, err);
    }
  }

  if (config.MARKETPLACE_CONTRACT_HASH && config.CARBON_PROJECT_KEY) {
    let pricePerToken = "15000000000";
    try {
      const [carbonPrice, csprPrice] = await Promise.all([
        fetchCarbonPrice(config.CARBON_PROJECT_KEY),
        fetchCsprUsdPrice(),
      ]);
      if (carbonPrice && csprPrice) {
        const fairMotes = BigInt(Math.floor((carbonPrice / csprPrice) * 1000000000));
        pricePerToken = fairMotes.toString();
        console.log(`[Verifier] Fair price: $${carbonPrice}/tonne × ${csprPrice} CSPR/USD = ${pricePerToken} motes`);
      }
    } catch (err) {
      console.warn(`[Verifier] Price fetch failed, using fallback price:`, err);
    }
    try {
      const listHash = await callContractEntryPoint(
        config.MARKETPLACE_CONTRACT_HASH,
        "list",
        {
          project_id: projectId.toString(),
          amount: String(supply),
          price_per_token: pricePerToken,
        },
        "5000000000",
      );
      console.log(`[Verifier] Listing created: ${listHash}`);
    } catch (err) {
      console.warn(`[Verifier] list failed:`, err);
    }
  }

  return deployHash;
}

async function verifySingleProject(projectId: number): Promise<void> {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`[Verifier] Analyzing project #${projectId}...`);

  const carbonData = await fetchCarbonProjectData(projectId);
  if (!carbonData) {
    console.log(`[Verifier] Skipping project #${projectId} — no data available`);
    console.log(`═══════════════════════════════════════════\n`);
    return;
  }
  console.log(`[Verifier] Project: ${carbonData.project_name}`);
  console.log(`[Verifier] Type: ${carbonData.project_type}`);
  console.log(`[Verifier] Location: ${carbonData.location}`);

  const llmResult = await verifyCarbonProject(carbonData);
  const supply = (llmResult.suggested_supply || carbonData.total_credits_issued).toString();

  if (llmResult.confidence === "high" && llmResult.score >= 60) {
    console.log(`[Verifier] Project PASSES verification (score=${llmResult.score})`);
    await submitVerification(projectId, llmResult, supply);
  } else if (llmResult.confidence === "medium" && llmResult.score >= 50) {
    console.log(`[Verifier] Project PASSES with medium confidence`);
    await submitVerification(projectId, llmResult, supply);
  } else {
    // Slashing requires AgentType::Compliance auth — the verifier leaves the
    // project Pending and the compliance agent handles enforcement.
    console.log(`[Verifier] Project FAILS verification (score=${llmResult.score}, confidence=${llmResult.confidence}) — leaving Pending for compliance review`);
  }

  console.log(`═══════════════════════════════════════════\n`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║       Casper Carbon — Verification Agent     ║
║        AI-Powered Carbon Credit Verifier      ║
╚══════════════════════════════════════════════╝
  `);

  const { publicKey } = await loadAgentKeypair();
  console.log(`[Verifier] Agent public key: ${publicKey.toHex()}`);
  console.log(`[Verifier] Network: ${config.CASPER_CHAIN_NAME}`);
  console.log(`[Verifier] Poll interval: ${config.POLL_INTERVAL_MS}ms\n`);

  async function poll() {
    try {
      console.log(`[Verifier] Polling for pending projects...`);
      const pendingProjects = await checkPendingProjects();

      if (pendingProjects.length === 0) {
        console.log(`[Verifier] No pending projects on chain — waiting for next poll`);
      } else {
        console.log(`[Verifier] Found ${pendingProjects.length} pending project(s): ${pendingProjects.join(", ")}`);
        for (const projectId of pendingProjects) {
          await verifySingleProject(projectId);
        }
      }
    } catch (err) {
      console.error(`[Verifier] Poll error:`, err);
    }
  }

  await poll();
  setInterval(poll, config.POLL_INTERVAL_MS);
}

main().catch(console.error);
