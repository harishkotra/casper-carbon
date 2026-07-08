import { config } from "./config.js";
import type { CarbonData } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function carbonmarkFetch<T>(path: string): Promise<T> {
  const url = `${config.CARBON_API_URL.replace(/\/+$/, "")}${path}`;
  let lastError: Error = new Error("unreachable");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.CARBON_API_KEY}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return response.json() as Promise<T>;
      lastError = new Error(`Carbonmark API error ${response.status} for ${url}: ${response.statusText}`);
      // Retry only transient gateway errors; 4xx are permanent
      if (response.status < 500) break;
      console.warn(`[Carbonmark] ${response.status} on ${path}, retrying (${attempt + 1}/3)...`);
    } catch (err) {
      lastError = err as Error;
      console.warn(`[Carbonmark] ${lastError.message} on ${path}, retrying (${attempt + 1}/3)...`);
    }
  }
  throw lastError;
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
  let prices: CarbonmarkPriceSource[];
  try {
    prices = await carbonmarkFetch<CarbonmarkPriceSource[]>(
      `/prices?projectIds=${encodeURIComponent(projectKey)}&assetPriceType=listing`,
    );
  } catch (err) {
    // /prices is occasionally down — fall back to the project's own listed
    // price from /carbonProjects (still live Carbonmark data, same floor)
    console.warn(`[Carbonmark] /prices unavailable, falling back to project price`);
    const project = await carbonmarkFetch<CarbonmarkProject>(`/carbonProjects/${projectKey}`);
    const p = parseFloat(project.price);
    return Number.isFinite(p) ? Math.max(p, 5) : null;
  }
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
