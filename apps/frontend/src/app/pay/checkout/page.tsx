"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, Check, Loader2, Lock, ShieldCheck, Sparkles, Users } from "lucide-react";

// The payment page the mobile app opens in a webview. The app's session id never gets here: it opens
// `/pay/checkout#t=<one-time token>`, this page trades the token for a session that reaches one order,
// and the plan is granted by the verify call below (or by Razorpay's webhook, if this page is closed first).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** What the member is buying: who the community is and what comes with it. */
interface CommunityInfo {
  name: string;
  description: string | null;
  type: string | null;
  tags: string[];
  coverImageUrl: string | null;
  badgeUrl: string | null;
  /** The "What you get" points the admin wrote. */
  whatsIncluded: string[];
  memberCount: number;
}

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
  community?: CommunityInfo;
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
      ...(order.community?.badgeUrl ? { image: order.community.badgeUrl } : {}),
      theme: { color: "#153d3a" },
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
  // An older server sends only the name; the page then shows just that.
  const community: CommunityInfo | null = order
    ? (order.community ?? { name: order.communityName, description: null, type: null, tags: [], coverImageUrl: null, badgeUrl: null, whatsIncluded: [], memberCount: 0 })
    : null;
  const duration = order ? `${order.durationMonths} month${order.durationMonths === 1 ? "" : "s"}` : "";
  const buying = (phase === "ready" || phase === "paying") && order && community;

  return (
    <main className={`mx-auto min-h-screen w-full max-w-md px-4 pt-4 ${buying || phase === "loading" ? "pb-40" : "pb-10"}`}>
      {phase === "loading" && <LoadingState />}

      {buying && (
        <>
          {/* Who it is */}
          <section className="animate-enter overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-primary/[0.04]">
            <Cover url={community.coverImageUrl} />
            <div className="relative px-5 pb-5">
              <Badge url={community.badgeUrl} className="absolute -top-7 left-5 h-14 w-14" />
              <div className="pt-9">
                {community.type && (
                  <span className="inline-block rounded-full bg-lime/50 px-2.5 py-0.5 text-[11px] font-bold text-primary">{community.type}</span>
                )}
                <h1 className="mt-2 font-display text-xl font-bold leading-snug text-primary">{community.name}</h1>
                {community.memberCount > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Users size={13} aria-hidden />
                    {community.memberCount.toLocaleString("en-IN")} member{community.memberCount === 1 ? "" : "s"}
                  </p>
                )}
                {community.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-primary/80">{community.description}</p>}
                {community.tags.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Topics">
                    {community.tags.map(tag => (
                      <li key={tag} className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold text-accent">
                        {tag}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* What the member gets */}
          {community.whatsIncluded.length > 0 && (
            <section className="animate-enter mt-4 rounded-3xl bg-white p-5 shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "80ms" }}>
              <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-primary">
                <Sparkles size={16} className="text-accent" aria-hidden />
                What you get
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {community.whatsIncluded.map(point => (
                  <li key={point} className="flex items-start gap-3 text-sm text-primary">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime text-primary" aria-hidden>
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span className="leading-snug">{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The plan and what it costs */}
          <section className="animate-enter mt-4 rounded-3xl bg-white p-5 shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "160ms" }}>
            <h2 className="font-display text-[15px] font-bold text-primary">Your plan</h2>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-background px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-bold text-primary">{order.planName}</p>
                <p className="text-xs text-muted">{duration} of access</p>
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums text-primary">{money(order.baseAmount)}</p>
            </div>
            <dl className="mt-4 flex flex-col gap-2 text-sm">
              {order.gstAmount > 0 && (
                <>
                  <div className="flex items-center justify-between text-muted">
                    <dt>Plan price</dt>
                    <dd className="tabular-nums">{money(order.baseAmount)}</dd>
                  </div>
                  <div className="flex items-center justify-between text-muted">
                    <dt>GST ({order.gstRatePercent}%)</dt>
                    <dd className="tabular-nums">{money(order.gstAmount)}</dd>
                  </div>
                </>
              )}
              <div className={`flex items-center justify-between ${order.gstAmount > 0 ? "mt-1 border-t border-divider pt-3" : ""}`}>
                <dt className="font-display font-bold text-primary">Total</dt>
                <dd className="font-display text-lg font-bold tabular-nums text-primary">{rupees}</dd>
              </div>
            </dl>
          </section>

          <p className="mt-5 flex items-center justify-center gap-1.5 px-6 text-center text-xs text-muted">
            <ShieldCheck size={14} className="shrink-0 text-accent" aria-hidden />
            Secure payment by Razorpay. Your access starts as soon as it is confirmed.
          </p>

          {/* The pay bar stays in reach however far the page is scrolled */}
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-divider bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur">
            <div className="mx-auto flex max-w-md items-center gap-4">
              <div className="shrink-0">
                <p className="text-[11px] font-semibold text-muted">Total</p>
                <p className="font-display text-lg font-bold leading-tight tabular-nums text-primary">{rupees}</p>
              </div>
              <button
                type="button"
                onClick={pay}
                disabled={phase === "paying"}
                className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === "paying" ? <Loader2 size={16} className="animate-spin text-lime" aria-hidden /> : <Lock size={15} className="text-lime" aria-hidden />}
                {phase === "paying" ? "Opening payment…" : `Pay ${rupees}`}
              </button>
            </div>
          </div>
        </>
      )}

      {phase === "confirming" && (
        <Centered>
          <Loader2 size={36} className="animate-spin text-accent" aria-hidden />
          <h1 className="mt-6 font-display text-xl font-bold text-primary">Confirming your payment</h1>
          <p className="mt-2 text-sm text-muted">Please don&apos;t close this screen.</p>
        </Centered>
      )}

      {phase === "paid" && (
        <Centered>
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-lime shadow-glow" aria-hidden>
            <Check size={38} strokeWidth={3} className="text-primary" />
          </span>
          <h1 className="mt-6 font-display text-2xl font-bold text-primary">Payment successful</h1>
          {community && (
            <p className="mt-3 text-sm leading-relaxed text-primary/80">
              You now have access to <span className="font-bold text-primary">{community.name}</span>
              {order ? ` for ${duration}` : ""}.
            </p>
          )}
          <p className="mt-2 text-sm text-muted">You can go back to the app now.</p>
        </Centered>
      )}

      {phase === "error" && (
        <Centered>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600" aria-hidden>
            <AlertTriangle size={30} />
          </span>
          <h1 className="mt-6 font-display text-xl font-bold text-primary">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">{message}</p>
          <p className="mt-5 max-w-xs text-xs leading-relaxed text-subtle">If money was taken, your access will be added shortly — you don&apos;t need to pay again.</p>
        </Centered>
      )}
    </main>
  );
}

/** The community's banner, in the 5:2 shape covers are uploaded in so none of it is cut off. Falls back to the brand gradient. */
function Cover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[5/2] w-full overflow-hidden" style={{ background: "linear-gradient(120deg, #0a5f57, #108b8b)" }}>
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Building2 size={30} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/40" aria-hidden />
      )}
    </div>
  );
}

/** The community's small icon, round and bordered so it sits cleanly on the banner's edge. */
function Badge({ url, className = "" }: { url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`flex items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-card ${className}`} aria-hidden>
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setFailed(true)} className="h-3/4 w-3/4 object-contain" />
      ) : (
        <Building2 size={20} className="text-accent" />
      )}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">{children}</div>;
}

const BONE = "rounded-full bg-divider";

/** One line of text as a bone: the box is as tall as the real line, the bone a little shorter inside it. */
function Line({ width, box = "h-5", bone = "h-3.5" }: { width: string; box?: string; bone?: string }) {
  return (
    <div className={`flex items-center ${box}`}>
      <div className={`${bone} ${width} ${BONE}`} />
    </div>
  );
}

/**
 * Placeholder shapes while the order is fetched. Built from the same cards, spacing and bottom bar as the page it
 * stands in for (banner and badge, name and description, the "What you get" list, the plan and its price, the pay
 * bar), and each bone sits in a box as tall as the line of text it stands for, so nothing moves when the real content
 * arrives. It cannot know what a community has filled in, so it shows a typical page; one with more or less simply
 * ends up taller or shorter.
 */
function LoadingState() {
  const card = "rounded-3xl bg-white shadow-card ring-1 ring-primary/[0.04]";
  return (
    <div className="animate-pulse" role="status" aria-label="Getting your payment ready">
      <span className="sr-only">Getting your payment ready…</span>

      {/* Who it is */}
      <section className={`overflow-hidden ${card}`}>
        <div className="aspect-[5/2] w-full bg-divider" />
        <div className="relative px-5 pb-5">
          <span className="absolute -top-7 left-5 h-14 w-14 rounded-full border-2 border-white bg-divider shadow-card" />
          <div className="pt-9">
            <div className={`h-5 w-32 ${BONE}`} />
            <div className="mt-2">
              <Line width="w-3/5" box="h-[27.5px]" bone="h-5" />
            </div>
            <div className={`mt-1.5 h-4 w-24 ${BONE}`} />
            <div className="mt-3">
              <Line width="w-full" box="h-[22.75px]" />
              <Line width="w-full" box="h-[22.75px]" />
              <Line width="w-2/3" box="h-[22.75px]" />
            </div>
            <div className="mt-3 flex gap-1.5">
              <div className={`h-6 w-24 ${BONE}`} />
              <div className={`h-6 w-16 ${BONE}`} />
              <div className={`h-6 w-20 ${BONE}`} />
            </div>
          </div>
        </div>
      </section>

      {/* What the member gets: some points fit on a line, some wrap */}
      <section className={`mt-4 p-5 ${card}`}>
        <div className="flex h-[22.5px] items-center gap-2">
          <div className={`h-4 w-4 ${BONE}`} />
          <div className={`h-4 w-28 ${BONE}`} />
        </div>
        <ul className="mt-4 flex flex-col gap-3">
          {[["w-11/12"], ["w-full", "w-1/2"], ["w-3/4"], ["w-full", "w-2/5"], ["w-4/5"]].map((lines, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-divider" />
              <div className="min-w-0 flex-1">
                {lines.map((width, j) => (
                  <Line key={j} width={width} box="h-[19.25px]" />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* The plan and what it costs */}
      <section className={`mt-4 p-5 ${card}`}>
        <div className="flex h-[22.5px] items-center">
          <div className={`h-4 w-20 ${BONE}`} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-background px-4 py-3">
          <div className="flex flex-col gap-2">
            <div className={`h-4 w-20 ${BONE}`} />
            <div className={`h-3 w-28 ${BONE}`} />
          </div>
          <div className={`h-4 w-16 ${BONE}`} />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex h-5 items-center justify-between">
            <div className={`h-4 w-20 ${BONE}`} />
            <div className={`h-4 w-16 ${BONE}`} />
          </div>
          <div className="flex h-5 items-center justify-between">
            <div className={`h-4 w-24 ${BONE}`} />
            <div className={`h-4 w-14 ${BONE}`} />
          </div>
          <div className="mt-1 border-t border-divider pt-3">
            <div className="flex h-7 items-center justify-between">
              <div className={`h-5 w-12 ${BONE}`} />
              <div className={`h-6 w-24 ${BONE}`} />
            </div>
          </div>
        </div>
      </section>

      <div className="mt-5 px-6">
        <Line width="w-full" box="h-4" bone="h-3" />
        <Line width="w-1/2" box="h-4" bone="h-3" />
      </div>

      {/* The pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-divider bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-4">
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className={`h-3 w-8 ${BONE}`} />
            <div className={`h-5 w-24 ${BONE}`} />
          </div>
          <div className="h-12 min-w-0 flex-1 rounded-full bg-divider" />
        </div>
      </div>
    </div>
  );
}
