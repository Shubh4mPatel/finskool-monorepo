"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  Gift,
  Info,
  ListChecks,
  Pencil,
  PlayCircle,
  ShieldAlert,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Select from "@/components/ui/Select";
import CommunityBadgeIcon from "@/components/CommunityBadgeIcon";
import { EmptyState, Skeleton } from "@/components/admin/dashboard/Panel";
import PriorityList from "@/components/admin/welcome-kit/PriorityList";
import YoutubeLinkList from "@/components/admin/welcome-kit/YoutubeLinkList";
import MarkdownField from "@/components/admin/welcome-kit/MarkdownField";
import WelcomeKitPreview from "@/components/admin/welcome-kit/WelcomeKitPreview";
import { timeAgo } from "@/lib/tickets";
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
  type KitListResponse,
  type KitVideo,
  type NoticeRow,
  type PointerRow,
  type ServerKit,
  type StrategyRow,
} from "@/lib/welcome-kit";

// No width here: `w-full` would override a narrower width added alongside it (e.g. the strategy value box).
const inputBase =
  "rounded-xl border border-divider bg-background px-3 py-2.5 text-sm text-primary placeholder:text-subtle transition-all focus:border-accent focus:bg-white focus:outline-none focus:ring-4 focus:ring-accent/10";
const inputCls = `w-full ${inputBase}`;

type SectionKey = "watch" | "capital" | "notice" | "what";
type SectionStatus = "done" | "incomplete" | "empty";

const SECTIONS: { key: SectionKey; title: string; hint: string; icon: LucideIcon }[] = [
  { key: "watch", title: "Watch before you start", hint: "A short intro and the videos new members should see first.", icon: PlayCircle },
  { key: "capital", title: "Capital Allocation", hint: "The recommended capital and the strategy at a glance.", icon: Wallet },
  { key: "notice", title: "Strategy Notice", hint: "Important notes and warnings about the strategy.", icon: ShieldAlert },
  { key: "what", title: "What You get", hint: "The benefits members get with this community.", icon: ListChecks },
];

/** A section's display fields — without `key`, which React won't accept inside spread props. */
function sectionProps(k: SectionKey): { title: string; hint: string; icon: LucideIcon } {
  const s = SECTIONS.find((x) => x.key === k)!;
  return { title: s.title, hint: s.hint, icon: s.icon };
}

/** Where a section stands — mirrors what validateForm() will accept or reject. */
function sectionStatus(form: KitForm, key: SectionKey): SectionStatus {
  switch (key) {
    case "watch":
      return hasWatchContent(form) ? "done" : "empty";
    case "capital":
      if (form.strategies.some((s) => !s.value.trim() || !s.label.trim())) return "incomplete";
      return hasCapitalContent(form) ? "done" : "empty";
    case "notice":
      if (form.notices.some((n) => !n.heading.trim())) return "incomplete";
      return form.notices.length > 0 ? "done" : "empty";
    case "what":
      if (form.pointers.some((p) => !p.text.trim())) return "incomplete";
      return form.pointers.length > 0 ? "done" : "empty";
  }
}

function StatusBadge({ status }: { status: SectionStatus }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-bold text-primary">
        <Check size={11} strokeWidth={3} aria-hidden /> Added
      </span>
    );
  }
  if (status === "incomplete") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
        <AlertTriangle size={11} aria-hidden /> Needs attention
      </span>
    );
  }
  return <span className="rounded-full bg-divider px-2.5 py-0.5 text-[11px] font-bold text-muted">Optional</span>;
}

/** A labelled field; the small pencil at the right of the label focuses the field. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold text-primary">{label}</p>
        <button
          type="button"
          title={`Edit ${label}`}
          aria-label={`Edit ${label}`}
          onClick={() => ref.current?.querySelector<HTMLElement>("input, textarea, select, button[aria-haspopup], [contenteditable='true']")?.focus()}
          className="flex h-6 w-6 items-center justify-center rounded-full text-subtle transition-colors hover:bg-accent/10 hover:text-accent"
        >
          <Pencil size={12} />
        </button>
      </div>
      {children}
    </div>
  );
}

/** A collapsible, numbered section card. Content stays mounted (so it can animate) but is inert while closed. */
function SectionCard({
  id,
  index,
  title,
  hint,
  icon: Icon,
  status,
  open,
  onToggle,
  delay,
  children,
}: {
  id: string;
  index: number;
  title: string;
  hint: string;
  icon: LucideIcon;
  status: SectionStatus;
  open: boolean;
  onToggle: () => void;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-enter scroll-mt-4 rounded-2xl border bg-white shadow-card transition-colors duration-300 ${
        status === "incomplete" ? "border-amber-300" : "border-transparent"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-background/50"
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            status === "done" ? "bg-gradient-to-br from-accent to-[#0b6f6f] text-white" : "bg-background text-accent"
          }`}
        >
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold tabular-nums text-subtle">{String(index).padStart(2, "0")}</span>
            <h2 className="font-display text-[17px] font-bold tracking-tight text-primary">{title}</h2>
            <StatusBadge status={status} />
          </span>
          <span className="mt-0.5 block text-xs text-muted">{hint}</span>
        </span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
            open ? "bg-accent text-white" : "bg-background text-accent group-hover:bg-accent/10"
          }`}
        >
          <ChevronDown size={15} strokeWidth={2.5} className={`transition-transform duration-300 ${open ? "" : "-rotate-90"}`} />
        </span>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden" inert={!open}>
          <div className="flex flex-col gap-6 border-t border-divider px-5 py-5">{children}</div>
        </div>
      </div>
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
      <div className="animate-fade absolute inset-0 bg-primary/30 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome kit preview"
        className="animate-enter relative z-10 flex max-h-[94vh] w-full max-w-[400px] flex-col rounded-3xl bg-background p-3 shadow-xl"
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
            Keep editing
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
  const confirm = useConfirm();

  const [community, setCommunity] = useState<KitListItem | null>(null);
  const [form, setForm] = useState<KitForm>(emptyForm);
  // What was last loaded/saved, as the server would store it — compared to spot unsaved changes.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  // Set once "Continue to Preview" has been blocked, so empty required boxes show up red.
  const [showInvalid, setShowInvalid] = useState(false);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ watch: true, capital: true, notice: true, what: true });
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<KitListResponse>("/api/v1/admin/welcome-kits"),
      api.get<ServerKit | null>(`/api/v1/admin/communities/${communityId}/welcome-kit`),
    ])
      .then(([list, kit]) => {
        if (!alive) return;
        setCommunity(list.items.find((c) => c.communityId === communityId) ?? null);
        const loaded = formFromKit(kit);
        setForm(loaded);
        setSavedSnapshot(JSON.stringify(kitPayload(loaded)));
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

  const dirty = savedSnapshot !== null && JSON.stringify(kitPayload(form)) !== savedSnapshot;

  // Closing the tab or reloading with unsaved edits asks first.
  useEffect(() => {
    if (!dirty || saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving]);

  // Props marking a required box red once the user has tried to continue with it empty.
  const required = (empty: boolean) => ({
    "data-invalid": showInvalid && empty,
    className: showInvalid && empty ? "!border-red-400 !bg-red-50" : "",
  });
  const patch = (p: Partial<KitForm>) => setForm((f) => ({ ...f, ...p }));
  const toggle = (k: SectionKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  function jumpTo(k: SectionKey) {
    setOpen((o) => ({ ...o, [k]: true }));
    document.getElementById(`kit-section-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function leave() {
    if (dirty) {
      const ok = await confirm({
        title: "Discard your changes?",
        message: "You have edits to this welcome kit that haven't been published. Leaving now will lose them.",
        confirmLabel: "Discard changes",
        variant: "danger",
      });
      if (!ok) return;
    }
    router.push("/admin/welcome-kit");
  }

  function continueToPreview() {
    const problem = validateForm(form);
    if (problem) {
      setShowInvalid(true);
      // Every section open, so whichever box is marked red is actually on screen.
      setOpen({ watch: true, capital: true, notice: true, what: true });
      toast.error(problem);
      // Wait for the red borders to render, then bring the first empty box into view.
      setTimeout(() => document.querySelector("[data-invalid='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
      return;
    }
    setStep("preview");
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/v1/admin/communities/${communityId}/welcome-kit`, kitPayload(form));
      setSavedSnapshot(JSON.stringify(kitPayload(form)));
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
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  if (!community) {
    return (
      <div className="flex max-w-[750px] flex-col rounded-2xl bg-white shadow-card">
        <EmptyState icon={<Gift size={20} />}>
          This community wasn&apos;t found, or you can&apos;t add a welcome kit to it.
        </EmptyState>
        <Link href="/admin/welcome-kit" className="mb-8 self-center text-sm font-semibold text-accent hover:underline">
          Back to Welcome Kit
        </Link>
      </div>
    );
  }

  const statuses = Object.fromEntries(SECTIONS.map((s) => [s.key, sectionStatus(form, s.key)])) as Record<SectionKey, SectionStatus>;
  const doneCount = SECTIONS.filter((s) => statuses[s.key] === "done").length;
  const anyContent = doneCount > 0 || SECTIONS.some((s) => statuses[s.key] === "incomplete");

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      {/* ── Editor ─────────────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-[750px] flex-col gap-5">
        <div className="animate-enter flex flex-wrap items-center gap-3">
          <Link
            href="/admin/welcome-kit"
            onClick={(e) => {
              if (!dirty) return;
              e.preventDefault();
              void leave();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary shadow-card ring-1 ring-primary/[0.04] transition-all hover:-translate-x-0.5 hover:shadow-card-hover"
          >
            <ArrowLeft size={14} />
            All kits
          </Link>
          <p className="text-xs font-semibold text-accent">
            Dashboard &rsaquo; Welcome Kit &rsaquo; <span className="text-primary">{community.name}</span>
          </p>
        </div>

        {/* Community banner */}
        <div
          className="animate-enter relative overflow-hidden rounded-2xl text-white shadow-card"
          style={{ background: "linear-gradient(120deg, #0a5f57, #108b8b)", animationDelay: "60ms" }}
        >
          {community.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={community.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 bg-gradient-to-r from-[#06433d]/95 via-[#0a5f57]/80 to-[#0a5f57]/40" />
          <div className="relative flex flex-wrap items-center gap-4 p-5">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-2 ring-white/40">
              <CommunityBadgeIcon badgeUrl={community.badgeUrl} className="h-8 w-8 object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              {community.type && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">{community.type}</p>
              )}
              <h1 className="truncate font-display text-xl font-bold leading-tight">{community.name}</h1>
              <p className="mt-0.5 text-xs text-white/75">
                {community.hasKit
                  ? community.updatedAt
                    ? `Welcome kit · updated ${timeAgo(community.updatedAt, now).toLowerCase()}`
                    : "Welcome kit"
                  : "New welcome kit — members don't have one yet"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-primary">
              {doneCount} of {SECTIONS.length} sections
            </span>
          </div>
        </div>

        <SectionCard
          id="kit-section-watch"
          index={1}
          {...sectionProps("watch")}
          status={statuses.watch}
          open={open.watch}
          onToggle={() => toggle("watch")}
          delay={120}
        >
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

        <SectionCard
          id="kit-section-capital"
          index={2}
          {...sectionProps("capital")}
          status={statuses.capital}
          open={open.capital}
          onToggle={() => toggle("capital")}
          delay={170}
        >
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

        <SectionCard
          id="kit-section-notice"
          index={3}
          {...sectionProps("notice")}
          status={statuses.notice}
          open={open.notice}
          onToggle={() => toggle("notice")}
          delay={220}
        >
          <PriorityList<NoticeRow>
            items={form.notices}
            onChange={(notices) => patch({ notices })}
            makeItem={() => ({ id: newId(), type: "normal", heading: "", description: "" })}
            addLabel="Add Strategy Notice"
            max={MAX_NOTICES}
            renderFields={(item, update) => (
              <div
                className={`flex flex-col gap-4 rounded-xl border p-4 transition-colors ${
                  item.type === "warning" ? "border-amber-200 bg-amber-50/40" : "border-divider bg-background/40"
                }`}
              >
                <Field label="Strategy Type">
                  <Select
                    value={item.type}
                    onChange={(type) => update({ type: type as NoticeRow["type"] })}
                    ariaLabel="Strategy type"
                    className="w-full"
                    triggerClassName={`relative flex w-full items-center gap-2 text-left ${inputBase} bg-white`}
                    options={[
                      { value: "normal", label: "Normal", hint: "General information", icon: <Info size={13} className="text-accent" /> },
                      { value: "warning", label: "Warning", hint: "Shown highlighted to members", icon: <AlertTriangle size={13} className="text-amber-600" /> },
                    ]}
                  />
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

        <SectionCard
          id="kit-section-what"
          index={4}
          {...sectionProps("what")}
          status={statuses.what}
          open={open.what}
          onToggle={() => toggle("what")}
          delay={270}
        >
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

        {/* Sticky action bar — always in reach at the bottom of a long form */}
        <div className="sticky bottom-0 z-20 -mx-1 bg-background/85 px-1 pb-4 pt-2 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card-hover ring-1 ring-primary/[0.04]">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted">
              <span className="tabular-nums text-primary">
                {doneCount}/{SECTIONS.length}
              </span>
              sections filled
              {dirty && (
                <span className="animate-fade inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => void leave()}
                className="rounded-full border border-divider bg-white px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={continueToPreview}
                className="flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
                style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
              >
                Continue to Preview
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Checklist + live preview (wide screens) ─────────────────────────── */}
      <aside className="hidden w-[360px] shrink-0 flex-col gap-4 xl:sticky xl:top-2 xl:flex">
        <div className="animate-enter rounded-2xl bg-white p-4 shadow-card" style={{ animationDelay: "120ms" }}>
          <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">Kit checklist</p>
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((s, i) => {
              const st = statuses[s.key];
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => jumpTo(s.key)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-background"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                        st === "done"
                          ? "bg-lime text-primary"
                          : st === "incomplete"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-background text-subtle"
                      }`}
                    >
                      {st === "done" ? <Check size={12} strokeWidth={3} /> : st === "incomplete" ? "!" : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{s.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="animate-enter flex max-h-[calc(100vh-15rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-card" style={{ animationDelay: "180ms" }}>
          <div className="flex items-center justify-between border-b border-divider px-4 py-3">
            <span className="flex items-center gap-1.5 rounded-full bg-lime px-3 py-1 text-xs font-bold text-primary">
              <Eye size={13} />
              Live preview
            </span>
            <span className="text-[11px] font-medium text-subtle">As members see it</span>
          </div>
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-4">
            {anyContent ? (
              <WelcomeKitPreview form={form} />
            ) : (
              <p className="py-10 text-center text-sm text-muted">Start filling in a section and it will appear here.</p>
            )}
          </div>
        </div>
      </aside>

      {step === "preview" && <PreviewModal form={form} saving={saving} onClose={() => setStep("edit")} onPublish={() => void save()} />}
    </div>
  );
}
