"use client";
import { useEffect, useState } from "react";
import { usePoll, short, explorer, timeAgo } from "@/lib/ui";
import { SkeletonCard, StatusBadge } from "@/components/shared";
import type { ChainProject } from "@/lib/casper-read";

const PIPELINE = ["Pending", "Verified", "Active"] as const;

interface Reasoning {
  score?: number;
  reasoning?: string;
  confidence?: string;
  suggested_supply?: number;
  evidence?: string[];
  is_fraudulent?: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ReasoningPanel({ hash }: { hash: string }) {
  const [state, setState] = useState<{
    reasoning: Reasoning | null;
    verified: boolean | null;
    missing: boolean;
  }>({ reasoning: null, verified: null, missing: false });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/reasoning/${hash}.json`);
        if (!res.ok) { if (alive) setState((s) => ({ ...s, missing: true })); return; }
        const text = await res.text();
        const computed = await sha256Hex(text);
        if (alive) setState({ reasoning: JSON.parse(text), verified: computed === hash, missing: false });
      } catch {
        if (alive) setState((s) => ({ ...s, missing: true }));
      }
    })();
    return () => { alive = false; };
  }, [hash]);

  if (state.missing) {
    return (
      <p className="text-xs text-zinc-500">
        Reasoning artifact not available locally — hash commitment on-chain:{" "}
        <span className="font-mono">{short(hash, 12)}</span>
      </p>
    );
  }
  if (!state.reasoning) return <p className="text-xs text-zinc-600">Loading reasoning…</p>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        {state.verified ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-400 ring-1 ring-emerald-500/30">
            ✓ SHA-256 verified against on-chain commitment
          </span>
        ) : (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-medium text-red-400 ring-1 ring-red-500/30">
            ✗ hash mismatch
          </span>
        )}
        <span className="font-mono text-zinc-600">{short(hash, 10)}</span>
      </div>
      {state.reasoning.reasoning && (
        <p className="text-sm leading-relaxed text-zinc-300">{state.reasoning.reasoning}</p>
      )}
      {state.reasoning.evidence && (
        <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
          {state.reasoning.evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      <div className="flex gap-4 text-xs text-zinc-500">
        {state.reasoning.score != null && <span>score {state.reasoning.score}/100</span>}
        {state.reasoning.confidence && <span>confidence: {state.reasoning.confidence}</span>}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ChainProject }) {
  const [open, setOpen] = useState(false);
  const stageIdx = project.status === "Slashed" ? -1 : PIPELINE.indexOf(project.status as (typeof PIPELINE)[number]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            <span className="mr-2 text-zinc-500">#{project.id}</span>
            {project.name}
          </h3>
          <p className="mt-0.5 text-sm text-zinc-500">{project.location}</p>
        </div>
        <StatusBadge status={project.status} />
      </div>

      {/* status pipeline */}
      <div className="mt-4 flex items-center gap-2">
        {project.status === "Slashed" ? (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Slashed by compliance agent — credits frozen
          </div>
        ) : (
          PIPELINE.map((stage, i) => (
            <div key={stage} className="flex items-center gap-2">
              {i > 0 && <div className={`h-px w-8 ${i <= stageIdx ? "bg-emerald-500" : "bg-zinc-700"}`} />}
              <div className="flex items-center gap-1.5 text-xs">
                <span className={`h-2 w-2 rounded-full ${i <= stageIdx ? "bg-emerald-400" : "bg-zinc-700"}`} />
                <span className={i <= stageIdx ? "text-zinc-300" : "text-zinc-600"}>{stage}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-500">AI score</div>
          <div className="font-medium tabular-nums">
            {project.verification_score > 0 ? `${project.verification_score}/100` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Credit supply</div>
          <div className="font-medium tabular-nums">
            {Number(project.total_credit_supply).toLocaleString()} t
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Verified</div>
          <div className="font-medium">{project.verified_at ? timeAgo(project.verified_at) : "—"}</div>
        </div>
      </div>

      {project.reasoning_hash && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <button
            onClick={() => setOpen(!open)}
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            {open ? "▾ Hide" : "▸ Show"} AI reasoning (hash-committed on-chain)
          </button>
          {open && <div className="mt-3"><ReasoningPanel hash={project.reasoning_hash} /></div>}
        </div>
      )}

      <div className="mt-3 text-xs text-zinc-600">
        verifier:{" "}
        <a href={explorer.account(project.verifier)} target="_blank" rel="noreferrer" className="font-mono hover:text-zinc-400">
          {short(project.verifier)}
        </a>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { data: projects, error, loading } = usePoll<ChainProject[]>("/api/projects");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Carbon projects</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Real-world carbon projects registered on Casper — verified autonomously by the AI
          verifier agent, with the full LLM reasoning committed on-chain as a SHA-256 hash.
        </p>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        {loading
          ? Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} lines={4} />)
          : (projects ?? []).map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}
