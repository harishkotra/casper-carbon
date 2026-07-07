"use client";
import { usePoll } from "@/lib/ui";
import { ActivityFeed, LoadingRow, Skeleton, StatCard, type ActivityItem } from "@/components/shared";
import type { ChainProject } from "@/lib/casper-read";

export default function Dashboard() {
  const { data: projects, loading: projectsLoading } = usePoll<ChainProject[]>("/api/projects");
  const { data: activity, error: activityError, loading: activityLoading } =
    usePoll<ActivityItem[]>("/api/activity", 10000);
  const { data: price, loading: priceLoading } = usePoll<{ price: number | null }>("/api/price", 60000);
  const stat = (v: React.ReactNode) => (projectsLoading ? <Skeleton className="h-7 w-12" /> : v);

  const verified = projects?.filter((p) => p.status === "Verified" || p.status === "Active") ?? [];
  const slashed = projects?.filter((p) => p.status === "Slashed") ?? [];
  const credits = verified.reduce((sum, p) => sum + Number(p.total_credit_supply), 0);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Autonomous carbon credit agents on Casper
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          Three AI agents verify real-world carbon projects with GPT-4o, tokenize their credits,
          police fraud, and market-make against live Carbonmark prices — every decision lands
          on-chain as a Casper testnet deploy.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Projects on-chain" value={stat(projects?.length ?? "—")} />
        <StatCard label="AI-verified" value={stat(verified.length)} sub="score ≥ threshold" />
        <StatCard label="Credits issued" value={stat(credits.toLocaleString())} sub="tonnes CO₂e" />
        <StatCard label="Slashed for fraud" value={stat(slashed.length)} sub="by compliance agent" />
        <StatCard
          label="Carbonmark spot"
          value={priceLoading ? <Skeleton className="h-7 w-12" /> : price?.price != null ? `$${price.price}` : "—"}
          sub="per tonne · live"
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Live agent activity</h2>
          <span className="text-xs text-zinc-500">
            on-chain deploys by agent accounts · refreshes every 10s
          </span>
        </div>
        <div className="px-4">
          {activityError ? (
            <div className="py-8 text-center text-sm text-red-400">{activityError}</div>
          ) : activityLoading ? (
            <LoadingRow label="Loading agent activity from testnet…" />
          ) : (
            <ActivityFeed items={activity ?? []} limit={25} />
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: "🔬",
            title: "Verifier Agent",
            body: "Pulls project data from the Carbonmark registry, scores methodology and additionality with GPT-4o, then submits verify_project + activate_project deploys. Its full reasoning is hash-committed on-chain.",
          },
          {
            icon: "🛡️",
            title: "Compliance Agent",
            body: "Continuously re-screens verified projects for fraud signals under its own on-chain identity, and autonomously slashes projects when confidence is high — with evidence hashed into the deploy.",
          },
          {
            icon: "📈",
            title: "Market Agent",
            body: "Watches the live Carbonmark spot price and cancels on-chain listings whose spread exceeds 50 bps, keeping the marketplace honest against the real-world market.",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="text-2xl">{card.icon}</div>
            <h3 className="mt-2 font-semibold">{card.title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{card.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
