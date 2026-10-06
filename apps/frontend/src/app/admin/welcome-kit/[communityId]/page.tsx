"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Eye, Pencil, X } from "lucide-react";
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

// No width here: `w-full` would override a narrower width added alongside it (e.g. the strategy value box).
const inputBase =
  "rounded-xl border border-divider bg-background px-3 py-2.5 text-sm text-primary placeholder:text-subtle transition-colors focus:border-accent focus:outline-none";
const inputCls = `w-full ${inputBase}`;

/** A labelled field; the teal pencil dot at the right of the label focuses the field. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-base font-medium text-primary">{label}</p>
        <button
          type="button"
          title={`Edit ${label}`}
          aria-label={`Edit ${label}`}
          onClick={() => ref.current?.querySelector<HTMLElement>("input, textarea, select, [contenteditable='true']")?.focus()}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white transition-transform hover:scale-110"
        >
          <Pencil size={10} />
        </button>
      </div>
      {children}
    </div>
  );
}

/** A collapsible section card: title + teal chevron, divider, then the fields. */
function SectionCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-divider bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 px-6 py-5 text-left ${open ? "border-b border-divider" : ""}`}
      >
        <h2 className="font-display text-xl font-medium text-primary">{title}</h2>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
          <ChevronDown size={13} strokeWidth={3} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        </span>
      </button>
      {open && <div className="flex flex-col gap-6 px-6 py-5">{children}</div>}
    </section>
  );
}

/** The preview as a pop-up over the editor: Cancel (or ×) goes back to editing, Publish saves the kit. */
function PreviewModal({
  form,
  saving,
  onClose,
  onPublish,
}: {
  form: KitForm;
  saving: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <div
        role="dialog"
        aria-label="Welcome kit preview"
        className="relative z-10 flex max-h-[94vh] w-full max-w-[400px] flex-col rounded-3xl bg-background p-3 shadow-xl"
      >
        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto rounded-2xl border border-divider bg-white">
          <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-5 pb-3 pt-5">
            <span className="flex items-center gap-1.5 rounded-full bg-lime px-3 py-1 text-xs font-bold text-primary">
              <Eye size={13} />
              Preview
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label="Close preview"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>
          <div className="px-5 pb-5">
            <WelcomeKitPreview form={form} />
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 pb-1 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-36 rounded-full border border-divider bg-white px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={saving}
            className="flex w-40 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            {saving ? "Publishing…" : "Publish"}
            {!saving && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
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
  // Set once "Continue to Preview" has been blocked, so empty required boxes show up red.
  const [showInvalid, setShowInvalid] = useState(false);
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

  // Props marking a required box red once the user has tried to continue with it empty.
  const required = (empty: boolean) => ({
    "data-invalid": showInvalid && empty,
    className: showInvalid && empty ? "!border-red-400 !bg-red-50" : "",
  });
  const patch = (p: Partial<KitForm>) => setForm((f) => ({ ...f, ...p }));
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  function continueToPreview() {
    const problem = validateForm(form);
    if (problem) {
      setShowInvalid(true);
      toast.error(problem);
      // Wait for the red borders to render, then bring the first empty box into view.
      setTimeout(() => document.querySelector("[data-invalid='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      return;
    }
    setStep("preview");
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/v1/admin/communities/${communityId}/welcome-kit`, kitPayload(form));
      toast.success("Welcome kit published.");
      router.push("/admin/welcome-kit");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to publish the welcome kit");
      setStep("edit");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex w-full max-w-[750px] flex-col gap-4">
        {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-white" />)}
      </div>
    );
  }

  if (!community) {
    return (
      <div className="max-w-[750px] rounded-2xl bg-white p-10 text-center shadow-card">
        <p className="text-sm text-muted">This community wasn&apos;t found, or you can&apos;t add a welcome kit to it.</p>
        <Link href="/admin/welcome-kit" className="mt-4 inline-block text-sm font-semibold text-accent hover:underline">
          Back to Welcome Kit
        </Link>
      </div>
    );
  }

  const header = (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/welcome-kit"
        aria-label="Back to Welcome Kit"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white transition-transform hover:scale-105"
      >
        <ArrowLeft size={14} />
      </Link>
      <div className="flex items-center gap-4 rounded-2xl border border-divider bg-white px-4 py-4">
        <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent text-lg text-white">
          <CommunityBadgeIcon badgeUrl={community.badgeUrl} className="h-6 w-6 object-contain brightness-0 invert" />
        </span>
        <span className="font-display text-base font-bold text-primary">{community.name}</span>
      </div>
    </div>
  );

  return (
    <div className="flex w-full max-w-[750px] flex-col gap-5">
      {header}

      <SectionCard title="Watch before you start" open={open.watch} onToggle={() => toggle("watch")}>
        <Field label="Intro paragraph">
          <MarkdownField
            value={form.introMarkdown}
            onChange={(introMarkdown) => patch({ introMarkdown })}
            placeholder="Welcome to the community! Both videos cover the full trading process, capital allocation, and how to follow the recommendations."
          />
        </Field>
        <Field label="Youtube Video">
          <YoutubeLinkList videos={form.videos} onChange={(videos) => patch({ videos })} />
        </Field>
      </SectionCard>

      <SectionCard title="Capital Allocation" open={open.capital} onToggle={() => toggle("capital")}>
        <Field label="Hero Stat">
          <input
            value={form.heroStat}
            onChange={(e) => patch({ heroStat: e.target.value })}
            maxLength={50}
            placeholder="₹50,000"
            className={inputCls}
          />
        </Field>
        <Field label="Description">
          <MarkdownField
            value={form.description}
            onChange={(description) => patch({ description })}
            placeholder="Minimum recommended capital. Deploy the full amount on each recommended trade rather than splitting it across positions."
          />
        </Field>
        <Field label="Strategy">
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
                  data-invalid={required(!item.value.trim())["data-invalid"]}
                  className={`${inputBase} w-20 shrink-0 ${required(!item.value.trim()).className}`}
                />
                <input
                  value={item.label}
                  onChange={(e) => update({ label: e.target.value })}
                  maxLength={100}
                  placeholder="Recommendations per week"
                  aria-label="Label"
                  data-invalid={required(!item.label.trim())["data-invalid"]}
                  className={`${inputBase} min-w-0 flex-1 ${required(!item.label.trim()).className}`}
                />
              </div>
            )}
          />
        </Field>
      </SectionCard>

      <SectionCard title="Strategy Notice" open={open.notice} onToggle={() => toggle("notice")}>
        <PriorityList<NoticeRow>
          items={form.notices}
          onChange={(notices) => patch({ notices })}
          makeItem={() => ({ id: newId(), type: "normal", heading: "", description: "" })}
          addLabel="Add Strategy Notice"
          max={MAX_NOTICES}
          renderFields={(item, update) => (
            <div className="flex flex-col gap-2 rounded-xl border border-divider p-3">
              <Field label="Strategy Type">
                <select
                  value={item.type}
                  onChange={(e) => update({ type: e.target.value as NoticeRow["type"] })}
                  className={inputCls}
                >
                  <option value="normal">Normal</option>
                  <option value="warning">Warning</option>
                </select>
              </Field>
              <Field label="Heading">
                <input
                  value={item.heading}
                  onChange={(e) => update({ heading: e.target.value })}
                  maxLength={100}
                  placeholder="~70% indicative accuracy"
                  data-invalid={required(!item.heading.trim())["data-invalid"]}
                  className={`${inputCls} ${required(!item.heading.trim()).className}`}
                />
              </Field>
              <Field label="Description">
                <MarkdownField
                  value={item.description}
                  onChange={(description) => update({ description })}
                  placeholder="Actual market performance may vary. No level of accuracy or return is guaranteed."
                />
              </Field>
            </div>
          )}
        />
      </SectionCard>

      <SectionCard title="What You get" open={open.what} onToggle={() => toggle("what")}>
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
              title="Wrap text in **double asterisks** to make it bold"
              data-invalid={required(!item.text.trim())["data-invalid"]}
              className={`${inputCls} ${required(!item.text.trim()).className}`}
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

      {step === "preview" && <PreviewModal form={form} saving={saving} onClose={() => setStep("edit")} onPublish={() => void save()} />}
    </div>
  );
}
