import { AlertTriangle, Check } from "lucide-react";
import type { KitForm } from "@/lib/welcome-kit";
import { hasCapitalContent, hasWatchContent } from "@/lib/welcome-kit";
import MarkdownView from "./MarkdownView";

/** A teal-headed card, as in the app. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-accent/40 bg-[#f5f7f6]">
      <h3 className="bg-accent px-4 py-2.5 font-display text-[15px] font-bold text-white">{title}</h3>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

/** How members will see the kit in the app (narrow, mobile-width column). */
export default function WelcomeKitPreview({ form }: { form: KitForm }) {
  const hasHero = form.heroStat.trim() !== "" || form.description.trim() !== "";

  return (
    <div className="flex flex-col gap-5">
      <h2 className="w-fit border-b-2 border-accent pb-1 font-display text-xl font-medium text-primary">Welcome Kit</h2>

      {hasWatchContent(form) && (
        <Section title="Watch before you start">
          {form.introMarkdown.trim() && <MarkdownView markdown={form.introMarkdown} size="xs" />}
          {form.videos.map((v) => (
            <div key={v.url} className="flex items-center gap-3 rounded-lg bg-white p-2 shadow-sm">
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.thumbnailUrl} alt="" className="h-[42px] w-[74px] shrink-0 rounded-sm object-cover" />
              ) : (
                <div className="h-[42px] w-[74px] shrink-0 rounded-sm bg-primary/80" />
              )}
              <p className="line-clamp-3 text-[11px] leading-snug text-primary">{v.title ?? v.url}</p>
            </div>
          ))}
        </Section>
      )}

      {hasCapitalContent(form) && (
        <Section title="Capital Allocation">
          {hasHero && (
            <div className="rounded-lg bg-white p-3 shadow-sm">
              {form.heroStat.trim() && <p className="font-display text-xl font-bold text-primary">{form.heroStat}</p>}
              {form.description.trim() && <MarkdownView markdown={form.description} size="xs" className="mt-1" />}
            </div>
          )}
          {form.strategies.length > 0 && (
            <>
              {form.strategyTitle.trim() && <p className="mt-1 font-display text-sm font-bold text-primary">{form.strategyTitle}</p>}
              <div className="grid grid-cols-2 gap-3">
                {form.strategies.map((s) => (
                  <div key={s.id} className="rounded-lg bg-white p-3 shadow-sm">
                    <p className="break-words font-display text-lg font-bold text-primary">{s.value}</p>
                    <p className="mt-1 text-[11px] leading-snug text-[#5a6a60]">{s.label}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      )}

      {form.notices.map((n) => {
        const warning = n.type === "warning";
        return (
          <div
            key={n.id}
            className={`flex gap-2.5 rounded-xl border p-3 ${warning ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
          >
            {warning ? (
              <AlertTriangle size={18} className="mt-0.5 shrink-0 fill-red-500 text-white" />
            ) : (
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                i
              </span>
            )}
            <div className="min-w-0">
              <p className={`text-[13px] font-bold ${warning ? "text-red-600" : "text-amber-700"}`}>{n.heading}</p>
              {n.description.trim() && <MarkdownView markdown={n.description} size="xs" tone={warning ? "red" : "amber"} className="mt-1" />}
            </div>
          </div>
        );
      })}

      {form.pointers.length > 0 && (
        <Section title="What You get">
          <ul className="flex flex-col gap-2">
            {form.pointers.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-primary">
                <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                  <Check size={9} strokeWidth={3.5} />
                </span>
                <MarkdownView markdown={p.text} size="xs" className="min-w-0 !text-primary" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Fixed closing text — the same for every community's kit. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-accent/40 bg-white p-3">
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
          i
        </span>
        <p className="text-xs leading-snug text-primary">
          Please ensure that you <strong>understand the trading</strong> process and associated risks before participating in any trade.
        </p>
      </div>
      <div className="flex flex-col items-center gap-0.5 pb-1 text-center text-xs font-bold leading-snug text-accent">
        <p>Saath Mein Seekhenge... Saath Mein Grow Karenge!!</p>
        <p>Our Mission: Har Ghar Ek Smart Investor!!</p>
      </div>
    </div>
  );
}
