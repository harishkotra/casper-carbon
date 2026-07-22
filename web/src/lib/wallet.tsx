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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    const w = (window as any).csprclick;
    if (!w) throw new Error("CSPR.click not installed");
    setConnecting(true);
    try {
      const result = await w.connect();
      const pk = result?.activeKey ?? result?.publicKey ?? null;
      if (pk) setPublicKey(pk);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
  }, []);

  useEffect(() => {
    const w = (window as any).csprclick;
    if (w?.isConnected?.()) {
      const pk = w.getActivePublicKey?.() ?? null;
      if (pk) setPublicKey(pk);
    }
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
