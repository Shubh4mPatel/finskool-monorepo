"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The payment page the mobile app opens in a webview. The app's session id never gets here: it opens
// `/pay/checkout#t=<one-time token>`, this page trades the token for a session that reaches one order,
// and the plan is granted by the verify call below (or by Razorpay's webhook, if this page is closed first).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface Order {
  sessionToken: string;
  status: string;
  orderId: string;
  /** Paise: the total, GST included. */
  amount: number;
  /** Paise: the plan's price before GST, and the GST added on top (0 when none). */
  baseAmount: number;
  gstAmount: number;
  gstRatePercent: number;
  currency: string;
  keyId: string;
  planName: string;
  durationMonths: number;
  communityName: string;
}

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: () => void) => void };
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

type Phase = "loading" | "ready" | "paying" | "confirming" | "paid" | "error";

async function api<T>(path: string, init: RequestInit = {}, sessionToken?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "omit", // nothing here depends on, or sends, any cookie
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? "Something went wrong");
  return json.data as T;
}

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment form"));
    document.body.appendChild(script);
  });
}

// Tells the app (when it listens) how this went; the app should still re-read the subscription from the API.
function tellApp(status: "paid" | "closed" | "error") {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "payment", status }));
}

export default function CheckoutPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    // Drop the token from the address bar and history straight away; it is single-use anyway.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setMessage("This payment link is not valid. Go back to the app and try again.");
      setPhase("error");
      return;
    }

    api<Order>("/api/v1/payments/checkout/exchange", { method: "POST", body: JSON.stringify({ token }) })
      .then(async data => {
        setOrder(data);
        if (data.status === "paid") {
          setPhase("paid");
          tellApp("paid");
          return;
        }
        await loadCheckoutScript();
        setPhase("ready");
      })
      .catch(err => {
        setMessage(err instanceof Error ? err.message : "Something went wrong");
        setPhase("error");
        tellApp("error");
      });
  }, []);

  // After the popup closes without a confirmed payment, or a verify failure, the webhook may still have granted
  // the plan — ask before telling the member it failed.
  const checkPaid = useCallback(async (o: Order): Promise<boolean> => {
    for (let i = 0; i < 5; i++) {
      try {
        const s = await api<{ status: string }>("/api/v1/payments/checkout/status", {}, o.sessionToken);
        if (s.status === "paid") return true;
      } catch {
        return false;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  }, []);

  const pay = useCallback(() => {
    if (!order || !window.Razorpay) return;
    setPhase("paying");

    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: order.communityName,
      description: `${order.planName} plan`,
      handler: async (response: RazorpaySuccess) => {
        setPhase("confirming");
        try {
          await api("/api/v1/payments/checkout/verify", {
            method: "POST",
            body: JSON.stringify({
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          }, order.sessionToken);
          setPhase("paid");
          tellApp("paid");
        } catch (err) {
          if (await checkPaid(order)) {
            setPhase("paid");
            tellApp("paid");
            return;
          }
          setMessage(err instanceof Error ? err.message : "We could not confirm your payment.");
          setPhase("error");
          tellApp("error");
        }
      },
      modal: {
        ondismiss: () => {
          setPhase("ready");
          tellApp("closed");
        },
      },
    });
    rzp.on("payment.failed", () => setPhase("ready"));
    rzp.open();
  }, [order, checkPaid]);

  const money = (paise: number) => (paise / 100).toLocaleString("en-IN", { style: "currency", currency: order?.currency ?? "INR" });
  const rupees = order ? money(order.amount) : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10 text-center">
      {phase === "loading" && <p className="text-sm text-gray-500">Getting your payment ready…</p>}

      {(phase === "ready" || phase === "paying") && order && (
        <>
          <h1 className="text-xl font-semibold">{order.communityName}</h1>
          <p className="mt-1 text-sm text-gray-500">{order.planName}</p>
          <p className="mt-6 text-3xl font-bold">{rupees}</p>
          {order.gstAmount > 0 && (
            <p className="mt-2 text-sm text-gray-500">
              {money(order.baseAmount)} + {money(order.gstAmount)} GST ({order.gstRatePercent}%)
            </p>
          )}
          <button
            type="button"
            onClick={pay}
            disabled={phase === "paying"}
            className="mt-8 rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {phase === "paying" ? "Opening payment…" : `Pay ${rupees}`}
          </button>
        </>
      )}

      {phase === "confirming" && <p className="text-sm text-gray-500">Confirming your payment — please don&apos;t close this screen.</p>}

      {phase === "paid" && (
        <>
          <h1 className="text-xl font-semibold">Payment successful</h1>
          <p className="mt-2 text-sm text-gray-500">You can go back to the app now.</p>
        </>
      )}

      {phase === "error" && (
        <>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-500">{message}</p>
          <p className="mt-4 text-xs text-gray-400">If money was taken, your access will be added shortly — you don&apos;t need to pay again.</p>
        </>
      )}
    </main>
  );
}
