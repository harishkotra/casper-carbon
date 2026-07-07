import { config } from "./config.js";
import type { CarbonData } from "../types.js";

async function carbonmarkFetch<T>(path: string): Promise<T> {
  const url = `${config.CARBON_API_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.CARBON_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Carbonmark API error ${response.status} for ${url}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export interface CarbonmarkProject {
  key: string;
  projectID: string;
  name: string;
  country: string;
  region: string;
  registry: string;
  methodologies: { id: string; category: string; name: string }[];
  vintages?: string[];
  price: string;
  hasSupply: boolean;
  stats: {
    totalBridged: number;
    totalRetired: number;
    totalSupply: number;
  };
  sustainableDevelopmentGoals?: string[];
  url: string;
}

export interface CarbonmarkPriceSource {
  sourceId: string;
  type: "listing" | "klimaprotocol";
  purchasePrice: number;
  baseUnitPrice: number;
  supply: number;
  liquidSupply: number;
  minFillAmount: number;
}

function projectToCarbonData(project: CarbonmarkProject): CarbonData {
  return {
    project_name: project.name,
    project_type: project.methodologies[0]?.category || "Unknown",
    methodology: project.methodologies[0]?.name || "Unknown",
    location: `${project.country}, ${project.region}`,
    registry: project.registry,
    total_credits_issued: project.stats.totalBridged || project.stats.totalSupply,
    verification_status: project.hasSupply ? "Verified" : "Unknown",
    additional_data: {
      key: project.key,
      projectID: project.projectID,
      price: project.price,
      totalSupply: String(project.stats.totalSupply),
      totalRetired: String(project.stats.totalRetired),
      url: project.url,
    },
  };
}

export async function fetchProjectByKey(key: string): Promise<CarbonData> {
  const project = await carbonmarkFetch<CarbonmarkProject>(`/carbonProjects/${key}`);
  return projectToCarbonData(project);
}

export async function searchProjectsByName(name: string): Promise<CarbonmarkProject[]> {
  return carbonmarkFetch<CarbonmarkProject[]>(`/carbonProjects?name=${encodeURIComponent(name)}`);
}

export async function fetchCarbonPrice(projectKey: string): Promise<number | null> {
  const prices = await carbonmarkFetch<CarbonmarkPriceSource[]>(
    `/prices?projectIds=${encodeURIComponent(projectKey)}&assetPriceType=listing`,
  );
  if (prices.length === 0) return null;
  // Use median price instead of minimum to avoid outlier low-quality credits skewing the market
  const sorted = [...prices].sort((a, b) => a.baseUnitPrice - b.baseUnitPrice);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1].baseUnitPrice + sorted[mid].baseUnitPrice) / 2
    : sorted[mid].baseUnitPrice;
  // Floor at $5/tonne — anything lower is data noise for our market agent
  return Math.max(median, 5);
}
