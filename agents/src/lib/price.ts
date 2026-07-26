const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price?ids=casper-network&vs_currencies=usd";

let cachedPrice: { price: number; ts: number } | null = null;

export async function fetchCsprUsdPrice(): Promise<number | null> {
  if (cachedPrice && Date.now() - cachedPrice.ts < 60_000) return cachedPrice.price;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(COINGECKO_API, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, Record<string, number>>;
      const price = json["casper-network"]?.usd ?? null;
      if (!price || price <= 0) throw new Error(`Unexpected price: ${price}`);
      cachedPrice = { price, ts: Date.now() };
      return price;
    } catch (err) {
      console.warn(`[Price] CoinGecko attempt ${attempt + 1} failed: ${(err as Error).message}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}
