"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import PriorityList from "@/components/admin/welcome-kit/PriorityList";
import YoutubeLinkList from "@/components/admin/welcome-kit/YoutubeLinkList";
import MarkdownField from "@/components/admin/welcome-kit/MarkdownField";
import WelcomeKitPreview from "@/components/admin/welcome-kit/WelcomeKitPreview";
import {
  MAX_NOTICES,
  MAX_POINTERS,
  MAX_STRATEGIES,
  emptyForm,
  formFromKit,
  hasCapitalContent,
  hasWatchContent,
  kitPayload,
  newId,
  validateForm,
  type KitForm,
  type KitListItem,
  type KitVideo,
  type NoticeRow,
  type PointerRow,
  type ServerKit,
  type StrategyRow,
} from "@/lib/welcome-kit";

const inputCls =
  "w-full rounded-xl border border-divider bg-background px-3 py-2.5 text-sm text-primary placeholder:text-subtle transition-colors focus:border-accent focus:outline-none";

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-sm font-bold text-primary">{children}</p>;
}

/** A collapsible section card; the round marker is filled once the section has content. */
function SectionCard({
  title,
  done,
  open,
  onToggle,
  children,
}: {
  title: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white shadow-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-5 text-left">
        <h2 className="font-display text-lg font-bold text-primary">{title}</h2>
        <span className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${done ? "border-accent bg-accent text-white" : "border-divider text-transparent"}`}
            title={done ? "Section filled in" : "Section is empty"}
          >
            <Check size={11} strokeWidth={3} />
          </span>
          {open ? <ChevronUp size={18} className="text-muted" /> : <ChevronDown size={18} className="text-muted" />}
        </span>
      </button>
      {open && <div className="flex flex-col gap-5 px-5 pb-5">{children}</div>}
    </section>
  );
}

export default function WelcomeKitEditorPage() {
  const { communityId } = useParams<{ communityId: string }>();
  const router = useRouter();
  const toast = useToast();

  const [community, setCommunity] = useState<KitListItem | null>(null);
  const [form, setForm] = useState<KitForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState({ watch: true, capital: true, notice: true, what: true });

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<KitListItem[]>("/api/v1/admin/welcome-kits"),
      api.get<ServerKit | null>(`/api/v1/admin/communities/${communityId}/welcome-kit`),
    ])
      .then(([list, kit]) => {
        if (!alive) return;
        setCommunity(list.find((c) => c.communityId === communityId) ?? null);
        const loaded = formFromKit(kit);
        setForm(loaded);
        // Saved kits only hold the URLs — look up titles/thumbnails for display (best effort).
        void Promise.all(
          loaded.videos.map((v) =>
            api
              .post<{ title: string | null; thumbnailUrl: string | null }>("/api/v1/posts/video-preview", { url: v.url })
              .then((p): KitVideo => ({ ...v, title: p.title, thumbnailUrl: p.thumbnailUrl }))
              .catch(() => v),
          ),
        ).then((videos) => alive && setForm((prev) => ({ ...prev, videos })));
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Failed to load the welcome kit"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [communityId, toast]);

  const patch = (p: Partial<KitForm>) => setForm((f) => ({ ...f, ...p }));
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  function continueToPreview() {
    const problem = validateForm(form);
    if (problem) return toast.error(problem);
    setStep("preview");
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/v1/admin/communities/${communityId}/welcome-kit`, kitPayload(form));
      toast.success("Welcome kit saved.");
      router.push("/admin/welcome-kit");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save the welcome kit");
      setStep("edit");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-white" />)}
      </div>
    );
  }

  if (!community) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-10 text-center shadow-card">
        <p className="text-sm text-muted">This community wasn&apos;t found, or you can&apos;t add a welcome kit to it.</p>
        <Link href="/admin/welcome-kit" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
          Back to Welcome Kit
        </Link>
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-3">
      <Link
        href="/admin/welcome-kit"
        aria-label="Back to Welcome Kit"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white transition-transform hover:scale-105"
      >
        <ArrowLeft size={15} />
      </Link>
      <span className="flex items-center gap-2 rounded-full border border-accent/40 bg-white px-4 py-1.5 text-sm font-semibold text-primary">
        <CommunityBadgeIcon badgeUrl={community.badgeUrl} />
        {community.name}
      </span>
    </div>
  );

  if (step === "preview") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {header}
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <span className="rounded-full bg-lime/40 px-3 py-1 text-xs font-bold text-primary">Preview</span>
          <p className="mb-5 mt-3 text-sm text-muted">This is roughly how members will see the kit in the app.</p>
          <WelcomeKitPreview communityName={community.name} form={form} />
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setStep("edit")}
            disabled={saving}
            className="w-40 rounded-full border border-divider bg-white px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50"
          >
            Back to edit
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="flex w-44 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save kit"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {header}

      <SectionCard title="Watch before you start" done={hasWatchContent(form)} open={open.watch} onToggle={() => toggle("watch")}>
        <div>
          <Label>Intro paragraph</Label>
          <MarkdownField
            value={form.introMarkdown}
            onChange={(introMarkdown) => patch({ introMarkdown })}
            placeholder="Welcome to the community! Both videos cover the full trading process, capital allocation, and how to follow the recommendations."
          />
        </div>
        <div>
          <Label>Youtube Video</Label>
          <YoutubeLinkList videos={form.videos} onChange={(videos) => patch({ videos })} />
        </div>
      </SectionCard>

      <SectionCard title="Capital Allocation" done={hasCapitalContent(form)} open={open.capital} onToggle={() => toggle("capital")}>
        <div>
          <Label>Hero Stat</Label>
          <input
            value={form.heroStat}
            onChange={(e) => patch({ heroStat: e.target.value })}
            maxLength={50}
            placeholder="₹50,000"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Description</Label>
          <textarea
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            maxLength={1000}
            rows={3}
            placeholder="Minimum recommended capital. Deploy the full amount on each recommended trade rather than splitting it across positions."
            className={`${inputCls} resize-y`}
          />
        </div>
        <div>
          <Label>Strategy</Label>
          <input
            value={form.strategyTitle}
            onChange={(e) => patch({ strategyTitle: e.target.value })}
            maxLength={100}
            placeholder="Strategy at a glance"
            className={`${inputCls} mb-3`}
          />
          <PriorityList<StrategyRow>
            items={form.strategies}
            onChange={(strategies) => patch({ strategies })}
            makeItem={() => ({ id: newId(), value: "", label: "" })}
            addLabel="Add Strategy"
            max={MAX_STRATEGIES}
            renderFields={(item, update) => (
              <div className="flex items-center gap-2">
                <input
                  value={item.value}
                  onChange={(e) => update({ value: e.target.value })}
                  maxLength={20}
                  placeholder="3"
                  aria-label="Value"
                  className={`${inputCls} w-20 shrink-0`}
                />
                <input
                  value={item.label}
                  onChange={(e) => update({ label: e.target.value })}
                  maxLength={100}
                  placeholder="Recommendations per week"
                  aria-label="Label"
                  className={inputCls}
                />
              </div>
            )}
          />
        </div>
      </SectionCard>

      <SectionCard title="Strategy Notice" done={form.notices.length > 0} open={open.notice} onToggle={() => toggle("notice")}>
        <PriorityList<NoticeRow>
          items={form.notices}
          onChange={(notices) => patch({ notices })}
          makeItem={() => ({ id: newId(), type: "normal", heading: "", description: "" })}
          addLabel="Add Strategy Notice"
          max={MAX_NOTICES}
          renderFields={(item, update) => (
            <div className="flex flex-col gap-2 rounded-xl border border-divider p-3">
              <div>
                <Label>Strategy Type</Label>
                <select
                  value={item.type}
                  onChange={(e) => update({ type: e.target.value as NoticeRow["type"] })}
                  className={inputCls}
                >
                  <option value="normal">Normal</option>
                  <option value="warning">Warning</option>
                </select>
              </div>
              <div>
                <Label>Heading</Label>
                <input
                  value={item.heading}
                  onChange={(e) => update({ heading: e.target.value })}
                  maxLength={100}
                  placeholder="~70% indicative accuracy"
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Description</Label>
                <textarea
                  value={item.description}
                  onChange={(e) => update({ description: e.target.value })}
                  maxLength={500}
                  rows={2}
                  placeholder="Actual market performance may vary. No level of accuracy or return is guaranteed."
                  className={`${inputCls} resize-y`}
                />
              </div>
            </div>
          )}
        />
      </SectionCard>

      <SectionCard title="What You get" done={form.pointers.length > 0} open={open.what} onToggle={() => toggle("what")}>
        <PriorityList<PointerRow>
          items={form.pointers}
          onChange={(pointers) => patch({ pointers })}
          makeItem={() => ({ id: newId(), text: "" })}
          addLabel="Add Pointer"
          max={MAX_POINTERS}
          renderFields={(item, update) => (
            <input
              value={item.text}
              onChange={(e) => update({ text: e.target.value })}
              maxLength={200}
              placeholder="Actual market performance may vary. No level of accuracy or return is guaranteed."
              aria-label="Pointer"
              className={inputCls}
            />
          )}
        />
      </SectionCard>

      <div className="flex items-center justify-center gap-3 pb-6">
        <button
          type="button"
          onClick={() => router.push("/admin/welcome-kit")}
          className="w-36 rounded-full border border-divider bg-white px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={continueToPreview}
          className="flex w-52 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
          style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
        >
          Continue to Preview
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
