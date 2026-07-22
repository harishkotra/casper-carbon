import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { WalletProvider } from "@/lib/wallet";
import { HeaderWallet } from "@/components/wallet-button";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Casper Carbon — Autonomous Carbon Credit Agents",
  description:
    "AI agents that verify, police, and market-make tokenized carbon credits on Casper testnet",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/market", label: "Marketplace" },
  { href: "/agents", label: "Agents" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased`}
      >
        <WalletProvider>
          <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400">
                  ⬡
                </span>
                Casper Carbon
              </Link>
              <nav className="flex gap-1 text-sm">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  casper-test · live
                </div>
                <HeaderWallet />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </WalletProvider>
        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-zinc-900 px-4 py-6 text-xs text-zinc-600">
          <span>
            Casper Carbon · autonomous agents verifying real-world carbon assets on Casper testnet
            · every agent action is an on-chain deploy
          </span>
          <span>
            Built by{" "}
            <a
              href="https://harishkotra.me"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-emerald-400"
            >
              Harish Kotra
            </a>{" "}
            ·{" "}
            <a
              href="https://dailybuild.xyz"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-emerald-400"
            >
              Check out my other builds
            </a>
          </span>
        </footer>
      </body>
    </html>
  );
}
