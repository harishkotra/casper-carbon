"use client";
import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";

interface WalletContextType {
  connected: boolean;
  publicKey: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType>({
  connected: false,
  publicKey: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
});

function getProvider() {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (typeof w.CasperWalletProvider === "function") {
    return w.CasperWalletProvider();
  }
  return null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) throw new Error("No wallet found — install Casper Wallet browser extension");

    setConnecting(true);
    try {
      await provider.requestConnection();
      // After approval, read the active public key
      let pk: string | null = null;
      if (provider.getActivePublicKey) {
        pk = await provider.getActivePublicKey();
      }
      if (!pk) throw new Error("No public key returned from wallet");
      setPublicKey(pk);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    const provider = getProvider();
    if (provider?.disconnect) provider.disconnect().catch(() => {});
    setPublicKey(null);
  }, []);

  return (
    <WalletContext.Provider value={{ connected: !!publicKey, publicKey, connecting, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
