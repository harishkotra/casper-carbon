"use client";
import { explorer, short, timeAgo } from "@/lib/ui";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Pending: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
    Verified: "bg-sky-500/10 text-sky-400 ring-sky-500/30",
    Active: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
    Slashed: "bg-red-500/10 text-red-400 ring-red-500/30",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[status] ?? "bg-zinc-800 text-zinc-400 ring-zinc-700"}`}>
      {status}
    </span>
  );
}

export function DeployLink({ hash, children }: { hash: string; children?: React.ReactNode }) {
  return (
    <a
      href={explorer.deploy(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
    >
      ⛓ {children ?? short(hash)}
    </a>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800 ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
      <Skeleton className="h-5 w-2/3" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={`h-3 ${i % 2 ? "w-1/2" : "w-5/6"}`} />
        ))}
      </div>
    </div>
  );
}

export function LoadingRow({ label = "Loading live chain state…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-zinc-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
      {label}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export interface ActivityItem {
  deploy_hash: string;
  timestamp: string;
  entry_point: string;
  args: Record<string, unknown>;
  error_message: string | null;
  agent: "verifier" | "compliance";
}

const AGENT_META = {
  verifier: { icon: "🔬", name: "Verifier Agent", color: "text-sky-400" },
  compliance: { icon: "🛡️", name: "Compliance Agent", color: "text-red-400" },
};

function describe(item: ActivityItem): string {
  const a = item.args;
  switch (item.entry_point) {
    case "verify_project":
      return `verified project #${a.project_id} — AI score ${a.score}/100, ${a.credit_supply} credits`;
    case "activate_project":
      return `activated project #${a.project_id} for trading`;
    case "slash_project":
      return `slashed project #${a.project_id} for fraud signals`;
    case "list":
      return `listed ${a.amount} credits of project #${a.project_id}`;
    case "cancel_listing":
      return `cancelled mispriced listing #${a.listing_id}`;
    case "register_project":
      return `registered project "${a.name}"`;
    case "register_agent":
      return `registered agent "${a.name}"`;
    case "set_agent_registry":
      return `wired the agent registry`;
    case "transfer":
      return `transferred CSPR`;
    default:
      return item.entry_point;
  }
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="py-12 text-center text-sm text-zinc-600">{message}</div>;
}

export function ActivityFeed({ items, limit }: { items: ActivityItem[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return <div className="py-8 text-center text-sm text-zinc-600">No agent activity yet</div>;
  return (
    <ul className="divide-y divide-zinc-800/80">
      {shown.map((item) => {
        const meta = AGENT_META[item.agent];
        return (
          <li key={item.deploy_hash} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 text-lg leading-none">{meta.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                <span className={`font-medium ${meta.color}`}>{meta.name}</span>{" "}
                <span className="text-zinc-300">{describe(item)}</span>
                {item.error_message && (
                  <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-400">
                    reverted: {item.error_message}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                <span>{timeAgo(item.timestamp)}</span>
                <DeployLink hash={item.deploy_hash} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
