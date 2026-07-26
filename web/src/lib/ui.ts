"use client";
import { useEffect, useRef, useState } from "react";

export function usePoll<T>(
  url: string,
  intervalMs = 30000,
): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      if (inflight.current) return; // skip if previous request still in-flight
      inflight.current = true;
      try {
        const res = await fetch(url);
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
        else { setData(json); setError(null); }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        inflight.current = false;
      }
    }
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [url, intervalMs]);
  return { data, error, loading: data === null && error === null };
}

export const explorer = {
  deploy: (hash: string) => `https://testnet.cspr.live/deploy/${hash}`,
  contract: (hash: string) => `https://testnet.cspr.live/contract/${hash}`,
  account: (hash: string) => `https://testnet.cspr.live/account/account-hash-${hash}`,
};

export function timeAgo(iso: string | number): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function short(hash: string, n = 8): string {
  return hash.length > n * 2 ? `${hash.slice(0, n)}…${hash.slice(-4)}` : hash;
}

export function motesToCspr(motes: string): string {
  return (Number(motes) / 1e9).toFixed(2);
}
