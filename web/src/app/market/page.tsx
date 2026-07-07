"use client";
import { usePoll, motesToCspr } from "@/lib/ui";
import { LoadingRow, Skeleton, StatCard } from "@/components/shared";
import type { ChainListing, ChainProject } from "@/lib/casper-read";

const TARGET_SPREAD_BPS = 50;

export default function MarketPage() {
  const { data: listings, error, loading } = usePoll<ChainListing[]>("/api/listings");
  const { data: projects } = usePoll<ChainProject[]>("/api/projects");
  const { data: price, loading: priceLoading } = usePoll<{ price: number | null }>("/api/price", 60000);
  const stat = (v: React.ReactNode) => (loading ? <Skeleton className="h-7 w-12" /> : v);

  const projectName = (id: number) => projects?.find((p) => p.id === id)?.name ?? `Project #${id}`;
  const active = listings?.filter((l) => l.active) ?? [];
  const cancelled = listings?.filter((l) => !l.active) ?? [];
  const supply = active.reduce((s, l) => s + Number(l.amount), 0);

  // same math as the market agent: listing price (motes) vs spot * 1e9
  const spreadBps = (listing: ChainListing): number | null => {
    if (price?.price == null) return null;
    const spot = price.price * 1e9;
    const p = Number(listing.price_per_token);
    return Math.round(Math.abs(p - spot) / 1e7);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Credit marketplace</h1>
        <p className="mt-1 text-sm text-zinc-400">
          On-chain listings created by the verifier agent. The market agent compares each listing
          against the live Carbonmark spot price and autonomously cancels anything more than{" "}
          {TARGET_SPREAD_BPS} bps off-market.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active listings" value={stat(active.length)} />
        <StatCard label="Listed supply" value={stat(supply.toLocaleString())} sub="tonnes CO₂e" />
        <StatCard
          label="Carbonmark spot"
          value={priceLoading ? <Skeleton className="h-7 w-12" /> : price?.price != null ? `$${price.price}` : "—"}
          sub="per tonne · live oracle"
        />
        <StatCard label="Delisted by agent" value={stat(cancelled.length)} sub="mispriced" />
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Listing</th>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3 text-right">Amount (t)</th>
              <th className="px-4 py-3 text-right">Price (CSPR)</th>
              <th className="px-4 py-3 text-right">Spread vs spot</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {(listings ?? []).map((l) => {
              const bps = spreadBps(l);
              const off = bps != null && bps > TARGET_SPREAD_BPS;
              return (
                <tr key={l.id} className={l.active ? "" : "opacity-50"}>
                  <td className="px-4 py-3 font-mono text-zinc-400">#{l.id}</td>
                  <td className="px-4 py-3">{projectName(l.project_id)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(l.amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{motesToCspr(l.price_per_token)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${off ? "text-amber-400" : "text-zinc-400"}`}>
                    {bps != null ? `${bps} bps` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {l.active ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 ring-1 ring-emerald-500/30">
                        active{off ? " · flagged" : ""}
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                        cancelled by market agent
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {loading && (
              <tr><td colSpan={6}><LoadingRow label="Loading listings from testnet…" /></td></tr>
            )}
            {listings && listings.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No listings yet — run the verifier agent</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
