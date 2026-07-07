import "dotenv/config";

export const config = {
  CASPER_RPC_URL: process.env.CASPER_RPC_URL || "https://node.testnet.cspr.cloud/rpc",
  CASPER_CHAIN_NAME: process.env.CASPER_CHAIN_NAME || "casper-test",
  AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY || "",
  // Compliance runs under its own on-chain identity (registered as AgentType::Compliance)
  COMPLIANCE_PRIVATE_KEY: process.env.COMPLIANCE_PRIVATE_KEY || "",

  X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL || "https://x402-facilitator.cspr.cloud",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o",

  CSPR_CLOUD_AUTH_TOKEN: process.env.CSPR_CLOUD_AUTH_TOKEN || "",
  CARBON_API_URL: process.env.CARBON_API_URL || "https://v19.api.carbonmark.com",
  CARBON_API_KEY: process.env.CARBON_API_KEY || "",
  CARBON_PROJECT_KEY: process.env.CARBON_PROJECT_KEY || "",

  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || "60000", 10),

  REGISTRY_CONTRACT_HASH: process.env.REGISTRY_CONTRACT_HASH || "",
  TOKEN_CONTRACT_HASH: process.env.TOKEN_CONTRACT_HASH || "",
  MARKETPLACE_CONTRACT_HASH: process.env.MARKETPLACE_CONTRACT_HASH || "",
  AGENT_REGISTRY_HASH: process.env.AGENT_REGISTRY_HASH || "",
};
