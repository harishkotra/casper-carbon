"use client";
import { useState } from "react";
import { usePoll, motesToCspr, explorer } from "@/lib/ui";
import { LoadingRow, Skeleton, StatCard } from "@/components/shared";
import { useWallet } from "@/lib/wallet";
import type { ChainListing, ChainProject } from "@/lib/casper-read";

const TARGET_SPREAD_BPS = 50;

function BuyButton({ listingId, amount, price, projectName }: {
  listingId: number; amount: string; price: string; projectName: string;
}) {
  const { connected, publicKey } = useWallet();
  const [buying, setBuying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleBuy() {
    if (!connected || !publicKey) return;
    setBuying(true);
    setResult(null);
    setErr(null);
    try {
      const r = await fetch(`/api/build-buy?listing_id=${listingId}&token_amount=${amount}&buyer=${publicKey}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);

      const csprclick = (window as any).csprclick;
      if (!csprclick?.sign) throw new Error("CSPR.click not available");

      const signedDeploy = await csprclick.sign(data.unsignedDeploy);
      const sub = await fetch("/api/submit-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedDeploy }),
      });
      const subData = await sub.json();
      if (subData.error) throw new Error(subData.error);

      setResult(subData.deployHash);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result ? (
        <a href={explorer.deploy(result)} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">
          ✓ {result.slice(0, 10)}…
        </a>
      ) : (
        <button
          onClick={handleBuy}
          disabled={buying || !connected}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {buying ? "Buying…" : "Buy"}
        </button>
      )}
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}

function WalletBar() {
  const { connected, publicKey, connect, connecting, disconnect } = useWallet();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3 text-sm">
      {connected ? (
        <>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {publicKey!.slice(0, 8)}…{publicKey!.slice(-4)}
          </span>
          <button onClick={disconnect} className="text-xs text-zinc-500 hover:text-zinc-300">
            disconnect
          </button>
        </>
      ) : (
        <>
          {err && <span className="text-xs text-red-400">{err}</span>}
          <button
            onClick={() => { setErr(null); connect().catch((e) => setErr(e.message)); }}
            disabled={connecting}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            {connecting ? "Connecting…" : "Connect CSPR.click"}
          </button>
        </>
      )}
    </div>
  );
}

export default function MarketPage() {
  const { data: listings, error, loading } = usePoll<ChainListing[]>("/api/listings");
  const { data: projects } = usePoll<ChainProject[]>("/api/projects");
  const { data: price, loading: priceLoading } = usePoll<{ price: number | null }>("/api/price", 60000);
  const stat = (v: React.ReactNode) => (loading ? <Skeleton className="h-7 w-12" /> : v);

  const projectName = (id: number) => projects?.find((p) => p.id === id)?.name ?? `Project #${id}`;
  const active = listings?.filter((l) => l.active) ?? [];
  const cancelled = listings?.filter((l) => !l.active) ?? [];
  const supply = active.reduce((s, l) => s + Number(l.amount), 0);

  const spreadBps = (listing: ChainListing): number | null => {
    if (price?.price == null) return null;
    const spot = price.price * 1e9;
    const p = Number(listing.price_per_token);
    return Math.round(Math.abs(p - spot) / 1e7);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credit marketplace</h1>
          <p className="mt-1 text-sm text-zinc-400">
            On-chain listings created by the verifier agent. The market agent compares each listing
            against the live Carbonmark spot price and autonomously cancels anything more than{" "}
            {TARGET_SPREAD_BPS} bps off-market.
          </p>
        </div>
        <WalletBar />
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

      {error && <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{error}</div>}

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
              <th className="px-4 py-3">Buy</th>
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
                  <td className="px-4 py-3">
                    {l.active ? (
                      <BuyButton
                        listingId={l.id}
                        amount={l.amount}
                        price={l.price_per_token}
                        projectName={projectName(l.project_id)}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {loading && (
              <tr><td colSpan={7}><LoadingRow label="Loading listings from testnet…" /></td></tr>
            )}
            {listings && listings.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600">No listings yet — run the verifier agent</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
