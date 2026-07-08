import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Live Carbonmark listing price for the tracked project (median, $5 floor —
// same logic as the market agent uses to reprice on-chain listings).
export async function GET() {
  try {
    const base = (process.env.CARBON_API_URL || "https://v19.api.carbonmark.com").replace(/\/$/, "");
    const key = process.env.CARBON_PROJECT_KEY || "";
    const headers = { Authorization: `Bearer ${process.env.CARBON_API_KEY}`, Accept: "application/json" };
    const res = await fetch(
      `${base}/prices?projectIds=${encodeURIComponent(key)}&assetPriceType=listing`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(15000) },
    ).catch(() => null);
    if (!res || !res.ok) {
      // /prices is occasionally down — fall back to the project's own listed price
      const pr = await fetch(`${base}/carbonProjects/${key}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!pr.ok) throw new Error(`Carbonmark ${pr.status}`);
      const project: { price: string } = await pr.json();
      const p = parseFloat(project.price);
      return NextResponse.json({ price: Number.isFinite(p) ? Math.max(p, 5) : null, projectKey: key, fallback: true });
    }
    const prices: { baseUnitPrice: number }[] = await res.json();
    if (!prices.length) return NextResponse.json({ price: null, projectKey: key });
    const sorted = [...prices].sort((a, b) => a.baseUnitPrice - b.baseUnitPrice);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1].baseUnitPrice + sorted[mid].baseUnitPrice) / 2
      : sorted[mid].baseUnitPrice;
    return NextResponse.json({ price: Math.max(median, 5), projectKey: key, sources: prices.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
