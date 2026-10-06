import { AlertTriangle, Check, Info, Play } from "lucide-react";
import type { KitForm } from "@/lib/welcome-kit";
import { hasCapitalContent, hasWatchContent } from "@/lib/welcome-kit";
import MarkdownView from "./MarkdownView";

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-base font-bold text-primary">{children}</h3>;
}

/** Approximate render of the kit as members will see it in the app. */
export default function WelcomeKitPreview({ communityName, form }: { communityName: string; form: KitForm }) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 rounded-[28px] border-4 border-primary/15 bg-background p-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Welcome kit</p>
        <h2 className="font-display text-xl font-bold text-primary">{communityName}</h2>
      </div>

      {hasWatchContent(form) && (
        <section className="flex flex-col gap-3">
          <Heading>Watch before you start</Heading>
          {form.introMarkdown.trim() && <MarkdownView markdown={form.introMarkdown} />}
          {form.videos.map((v) => (
            <div key={v.url} className="overflow-hidden rounded-xl bg-white shadow-card">
              <div className="relative aspect-video bg-primary/90">
                {v.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-primary shadow">
                    <Play size={18} className="ml-0.5 fill-current" />
                  </span>
                </span>
              </div>
              {v.title && <p className="px-3 py-2 text-xs font-semibold text-primary">{v.title}</p>}
            </div>
          ))}
        </section>
      )}

      {hasCapitalContent(form) && (
        <section className="flex flex-col gap-3">
          <Heading>Capital Allocation</Heading>
          {form.heroStat.trim() && (
            <div className="rounded-xl bg-primary px-4 py-4 text-white">
              <p className="font-display text-3xl font-bold">{form.heroStat}</p>
              {form.description.trim() && <p className="mt-1.5 text-xs leading-relaxed text-white/80">{form.description}</p>}
            </div>
          )}
          {!form.heroStat.trim() && form.description.trim() && <p className="text-sm text-[#5a6a60]">{form.description}</p>}
          {form.strategies.length > 0 && (
            <div className="rounded-xl bg-white p-4 shadow-card">
              {form.strategyTitle.trim() && <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{form.strategyTitle}</p>}
              <ul className="flex flex-col divide-y divide-divider">
                {form.strategies.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-3 py-2">
                    <span className="min-w-12 font-display text-lg font-bold text-accent">{s.value}</span>
                    <span className="text-sm text-primary">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {form.notices.length > 0 && (
        <section className="flex flex-col gap-3">
          <Heading>Strategy Notice</Heading>
          {form.notices.map((n) => (
            <div
              key={n.id}
              className={`flex gap-3 rounded-xl border p-3 ${n.type === "warning" ? "border-amber-300 bg-amber-50" : "border-accent/30 bg-accent/5"}`}
            >
              {n.type === "warning" ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" /> : <Info size={16} className="mt-0.5 shrink-0 text-accent" />}
              <div>
                <p className="text-sm font-bold text-primary">{n.heading}</p>
                {n.description.trim() && <p className="mt-0.5 text-xs leading-relaxed text-[#5a6a60]">{n.description}</p>}
              </div>
            </div>
          ))}
        </section>
      )}

      {form.pointers.length > 0 && (
        <section className="flex flex-col gap-3">
          <Heading>What You get</Heading>
          <ul className="flex flex-col gap-2">
            {form.pointers.map((p) => (
              <li key={p.id} className="flex items-start gap-2.5 text-sm text-primary">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                  <Check size={10} strokeWidth={3} />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
