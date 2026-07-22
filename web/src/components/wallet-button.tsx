"use client";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { short } from "@/lib/ui";

export function HeaderWallet() {
  const { connected, publicKey, connect, connecting, disconnect } = useWallet();
  const [err, setErr] = useState<string | null>(null);

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-md border border-emerald-800 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {short(publicKey, 6)}
        </span>
        <button onClick={disconnect} className="text-xs text-zinc-600 hover:text-zinc-400" title="Disconnect">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-red-400">{err}</span>}
      <button
        onClick={() => { setErr(null); connect().catch((e) => setErr(e.message)); }}
        disabled={connecting}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
      >
        {connecting ? "…" : "Connect"}
      </button>
    </div>
  );
}
