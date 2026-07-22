export interface Project {
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

export interface AgentInfo {
  address: string;
  name: string;
  agent_type: "Verifier" | "Market" | "Compliance";
  reputation_score: number;
  total_verifications: number;
  successful_verifications: number;
  is_active: boolean;
}

export interface Listing {
  id: number;
  seller: string;
  project_id: number;
  amount: string;
  price_per_token: string;
  active: boolean;
}

export interface VerificationResult {
  score: number;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  suggested_supply: number;
}

export interface CarbonData {
  project_name: string;
  project_type: string;
  methodology: string;
  location: string;
  registry: string;
  total_credits_issued: number;
  verification_status: string;
  additional_data: Record<string, string>;
}
