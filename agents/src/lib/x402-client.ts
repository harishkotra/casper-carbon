import { config } from "./config.js";

export async function fetchWithX402<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 402) {
    const paymentReq: any = await response.json();
    return handlePayment<T>(url, paymentReq, options);
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function handlePayment<T>(
  originalUrl: string,
  _paymentReq: any,
  originalOptions: RequestInit,
): Promise<T> {
  console.log(`[x402] Payment required, settling...`);

  const settled = await settlePayment();
  if (!settled.paid) {
    throw new Error("x402 payment failed");
  }

  const retryResponse = await fetch(originalUrl, {
    ...originalOptions,
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": `casper:casper-test:${settled.transaction_hash}`,
      ...originalOptions.headers,
    },
  });

  if (!retryResponse.ok) {
    throw new Error(`Retry failed after payment: ${retryResponse.status}`);
  }

  return retryResponse.json() as Promise<T>;
}

async function settlePayment(): Promise<{ paid: boolean; transaction_hash?: string }> {
  try {
    const settleResponse = await fetch(`${config.X402_FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network: "casper:casper-test", scheme: "exact", asset: "CSPR", amount: "1000000" }),
    });

    if (!settleResponse.ok) {
      return simulatePayment();
    }

    return settleResponse.json() as Promise<{ paid: boolean; transaction_hash?: string }>;
  } catch {
    return simulatePayment();
  }
}

function simulatePayment() {
  const fakeHash = "x402-sim-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 10);
  console.log(`[x402] Simulated payment hash: ${fakeHash}`);
  return { paid: true, transaction_hash: fakeHash };
}
