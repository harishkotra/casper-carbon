"use client";
import { usePoll, explorer, short } from "@/lib/ui";
import { ErrorCard, EmptyState, SkeletonCard } from "@/components/shared";
import type { ChainAgent } from "@/lib/casper-read";

type AgentRow = ChainAgent & { role: string; publicKey: string; accountHash: string };

const ROLE_META: Record<string, { icon: string; blurb: string }> = {
  verifier: {
    icon: "🔬",
    blurb:
      "Scores carbon projects with GPT-4o against Carbonmark registry data, then verifies, activates, and lists credits on-chain. Also acts as the market maker.",
  },
  compliance: {
    icon: "🛡️",
    blurb:
      "Independent on-chain identity that re-screens verified projects for fraud and autonomously slashes them — reputation is earned and lost on-chain.",
  },
};

export default function AgentsPage() {
  const { data: agents, error, loading } = usePoll<AgentRow[]>("/api/agents", 30000);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent registry</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Each agent is a first-class on-chain identity in the AgentRegistry contract: typed,
          permissioned, and carrying a reputation score updated by the contracts themselves.
          Contract-level auth means a verifier cannot slash and a compliance agent cannot verify.
        </p>
      </div>

      {error && <ErrorCard message={error} />}

      <div className="grid gap-4 md:grid-cols-2">
        {loading && Array.from({ length: 2 }, (_, i) => <SkeletonCard key={i} lines={5} />)}
        {!loading && !error && agents && agents.length === 0 && <div className="md:col-span-2"><EmptyState message="No agents registered on-chain yet" /></div>}
        {(agents ?? []).map((agent) => {
          const meta = ROLE_META[agent.role] ?? { icon: "🤖", blurb: "" };
          return (
            <div key={agent.role} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{meta.icon}</span>
                  <div>
                    <h3 className="font-semibold">{agent.name}</h3>
                    <span className="text-xs text-zinc-500">AgentType::{agent.agent_type}</span>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${
                    agent.is_active
                      ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
                      : "bg-zinc-800 text-zinc-500 ring-zinc-700"
                  }`}
                >
                  {agent.is_active ? "active" : "inactive"}
                </span>
              </div>

              <p className="mt-3 text-sm text-zinc-400">{meta.blurb}</p>

              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-zinc-500">Reputation</div>
                  <div className="font-semibold tabular-nums">{agent.reputation_score}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Verifications</div>
                  <div className="font-semibold tabular-nums">{agent.total_verifications}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Successful</div>
                  <div className="font-semibold tabular-nums">{agent.successful_verifications}</div>
                </div>
              </div>

              <div className="mt-4 space-y-1 border-t border-zinc-800 pt-3 text-xs text-zinc-600">
                <div>
                  account:{" "}
                  <a
                    href={explorer.account(agent.accountHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-zinc-400 hover:text-emerald-400"
                  >
                    {short(agent.accountHash, 12)}
                  </a>
                </div>
                <div>
                  public key: <span className="font-mono">{short(agent.publicKey, 12)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
