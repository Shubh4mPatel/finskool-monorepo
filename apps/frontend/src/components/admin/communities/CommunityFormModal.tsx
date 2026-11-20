"use client";

import { useEffect, useId, useState } from "react";
import { Building2, Check, Lock, Plus, Trash2, Wallet, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import CommunityCoverImageUploader from "@/components/admin/CommunityCoverImageUploader";
import CommunityBadgeUploader from "@/components/admin/CommunityBadgeUploader";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";
import { rupees } from "@/lib/dashboard";
import { slugify, type Community } from "./types";

// Limits mirror the backend's community schema.
const NAME_MAX = 150;
const DESCRIPTION_MAX = 2000;
const TAG_MAX = 50;
const TYPE_MAX = 50;
const POINT_MAX = 200;
const POINTS_LIMIT = 20;
const DURATIONS = [1, 3, 6, 12, 24];

interface ApiPlan {
  id: string;
  name: string;
  durationMonths: number;
  price: number;
}

/** A plan row in the form. `id` is set for a plan that already exists; new rows have none until they are saved. */
interface PlanDraft {
  key: number;
  id?: string;
  name: string;
  durationMonths: number;
  price: string;
}

const planName = (months: number) => `${months} Month${months === 1 ? "" : "s"}`;
const perMonth = (p: PlanDraft) => {
  const price = Number(p.price);
  return price > 0 ? price / p.durationMonths : null;
};
const toDraft = (p: ApiPlan): PlanDraft => ({ key: Number.NaN, id: p.id, name: p.name, durationMonths: p.durationMonths, price: String(p.price) });

/**
 * Create or edit a community. Creating can set the slug (generated from the name until you edit it);
 * once a community exists its slug is fixed.
 */
export default function CommunityFormModal({
  community,
  onClose,
  onSaved,
}: {
  /** Omit to create a new community. */
  community?: Community;
  onClose: () => void;
  onSaved: (c: Community) => void;
}) {
  const toast = useToast();
  const formId = useId();
  const editing = !!community;

  const [name, setName] = useState(community?.name ?? "");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState(community?.type ?? "");
  const [description, setDescription] = useState(community?.description ?? "");
  const [tags, setTags] = useState<string[]>(community?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [points, setPoints] = useState<string[]>(community?.whatsIncluded?.length ? community.whatsIncluded : [""]);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(community?.coverImageUrl ?? null);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(community?.badgeUrl ?? null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // Plans are only managed on an existing paid community (the create page sets them up for a new one).
  const managesPlans = editing && !community.isFree;
  const [plans, setPlans] = useState<PlanDraft[] | null>(null);
  const [savedPlans, setSavedPlans] = useState<ApiPlan[]>([]);
  const [plansLoadError, setPlansLoadError] = useState(false);
  const [plansError, setPlansError] = useState<string | undefined>();
  const [nextKey, setNextKey] = useState(1);

  function applyLoadedPlans(list: ApiPlan[]) {
    setSavedPlans(list);
    setPlans(list.map((p, i) => ({ ...toDraft(p), key: i + 1 })));
    setNextKey(list.length + 1);
  }

  async function loadPlans() {
    if (!community) return;
    setPlansLoadError(false);
    try {
      applyLoadedPlans(await api.get<ApiPlan[]>(`/api/v1/admin/communities/${community.id}/plans`));
    } catch {
      setPlansLoadError(true);
    }
  }

  useEffect(() => {
    if (managesPlans) void loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updatePlan = (key: number, patch: Partial<PlanDraft>) => {
    setPlans((prev) => prev && prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setPlansError(undefined);
  };

  function addPlan() {
    if (!plans) return;
    // Default the new plan to the first duration not used yet.
    const free = DURATIONS.find((d) => !plans.some((p) => p.durationMonths === d)) ?? DURATIONS[0]!;
    setPlans([...plans, { key: nextKey, name: planName(free), durationMonths: free, price: "" }]);
    setNextKey((k) => k + 1);
    setPlansError(undefined);
  }

  function removePlan(key: number) {
    setPlans((prev) => prev && prev.filter((p) => p.key !== key));
    setPlansError(undefined);
  }

  function changeDuration(plan: PlanDraft, months: number) {
    // A plan still carrying its automatic name follows the duration; a custom name is left alone.
    const auto = plan.name === planName(plan.durationMonths);
    updatePlan(plan.key, { durationMonths: months, name: auto ? planName(months) : plan.name });
  }

  function validatePlans(): string | undefined {
    if (!plans) return undefined;
    if (plans.length === 0) return "Add at least one plan";
    if (plans.some((p) => !(Number(p.price) > 0))) return "Every plan needs a price above ₹0";
    if (new Set(plans.map((p) => p.durationMonths)).size !== plans.length) return "Each plan needs a different duration";
    return undefined;
  }

  /** Brings the saved plans in line with the form: removed ones are deleted, changed ones updated, new ones created. */
  async function syncPlans(communityId: string): Promise<string[]> {
    if (!plans) return [];
    const base = `/api/v1/admin/communities/${communityId}/plans`;
    const failed: string[] = [];
    const run = async (label: string, op: () => Promise<unknown>) => {
      try {
        await op();
      } catch {
        failed.push(label);
      }
    };

    const keptIds = new Set(plans.flatMap((p) => (p.id ? [p.id] : [])));
    for (const old of savedPlans.filter((p) => !keptIds.has(p.id))) {
      await run(old.name, () => api.delete(`${base}/${old.id}`));
    }
    for (const p of plans) {
      const body = { name: p.name.trim() || planName(p.durationMonths), durationMonths: p.durationMonths, price: Number(p.price) };
      if (p.id) {
        const old = savedPlans.find((s) => s.id === p.id);
        if (old && old.name === body.name && old.durationMonths === body.durationMonths && old.price === body.price) continue;
        await run(body.name, () => api.patch(`${base}/${p.id}`, body));
      } else {
        await run(body.name, () => api.post(base, body));
      }
    }
    return failed;
  }

  function handleNameChange(value: string) {
    setName(value);
    setNameError(undefined);
    if (!editing && !slugTouched) setSlug(slugify(value));
  }

  function commitTag() {
    const t = tagInput.trim().replace(/,$/, "").trim();
    setTagInput("");
    if (!t) return;
    // A tag already there (any capitalisation) is a no-op rather than a duplicate chip.
    setTags((prev) => (prev.some((x) => x.toLowerCase() === t.toLowerCase()) ? prev : [...prev, t]));
  }

  function onTagKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  const cleanPoints = points.map((p) => p.trim()).filter(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Name is required");
      return;
    }
    const planProblem = validatePlans();
    setPlansError(planProblem);
    if (planProblem) return;
    setSaving(true);
    try {
      if (community) {
        const updated = await api.patch<Community>(`/api/v1/admin/communities/${community.id}`, {
          name: name.trim(),
          description: description.trim() || undefined,
          type: type.trim() || undefined,
          tags,
          whatsIncluded: cleanPoints,
          coverImageUrl: coverImageUrl ?? undefined,
          badgeUrl: badgeUrl ?? undefined,
        });
        const failedPlans = await syncPlans(community.id);
        onSaved(updated);
        if (failedPlans.length > 0) {
          // The community itself is saved; show what the plans really look like now so the rest can be retried.
          setPlansError(`These plans could not be saved: ${failedPlans.join(", ")}. Check them and save again.`);
          await loadPlans();
          return;
        }
        toast.success("Community updated.");
      } else {
        const created = await api.post<Community>("/api/v1/admin/communities", {
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || undefined,
          type: type.trim() || undefined,
          tags,
          whatsIncluded: cleanPoints,
          coverImageUrl: coverImageUrl ?? undefined,
          badgeUrl: badgeUrl ?? undefined,
        });
        toast.success("Community created.");
        onSaved(created);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "COMMUNITY_NAME_EXISTS") setNameError(err.message);
      else toast.error(err instanceof ApiError ? err.message : `Failed to ${editing ? "update" : "create"} community`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? "Edit Community" : "Create Community"}
      subtitle={editing ? community.name : "Set up a new space for your members."}
      icon={<Building2 size={18} />}
      size="lg"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={secondaryBtn}>Cancel</button>
          <button type="submit" form={formId} disabled={saving} className={primaryBtn}>
            {saving ? (editing ? "Saving…" : "Creating…") : editing ? "Save Changes" : "Create Community"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <CommunityCoverImageUploader large coverImageUrl={coverImageUrl} onChange={setCoverImageUrl} />
          <CommunityBadgeUploader large noun="Icon" badgeUrl={badgeUrl} onChange={setBadgeUrl} />
          <p className="text-[11px] text-subtle">The icon is a small SVG shown next to the community name in the app and on the web.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Community name" error={nameError}>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              maxLength={NAME_MAX}
              placeholder="e.g. Swing Alpha"
              autoFocus
              className={inputCls(nameError)}
            />
          </FormField>

          <FormField label="Community type">
            <input
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              maxLength={TYPE_MAX}
              placeholder="e.g. Short Term Investment"
              className={inputCls()}
            />
          </FormField>
        </div>

        <FormField label="Slug">
          {editing ? (
            <p className="flex items-center gap-2 rounded-xl bg-background px-4 py-2.5 text-sm text-muted">
              <Lock size={13} className="shrink-0 text-subtle" aria-hidden />
              <span className="truncate">/{community.slug}</span>
              <span className="ml-auto shrink-0 text-[11px] text-subtle">can&apos;t be changed</span>
            </p>
          ) : (
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-subtle">/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                placeholder="auto-generated-from-name"
                className={`${inputCls()} pl-7`}
              />
            </div>
          )}
        </FormField>

        <FormField label="Club options">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="What is this community about? Members see this before they subscribe."
            className={`${inputCls()} resize-none`}
          />
          <span className="mt-1 block text-right text-[11px] tabular-nums text-subtle">{description.length}/{DESCRIPTION_MAX}</span>
        </FormField>

        <FormField label="Add tags">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-white px-3 py-2.5 transition-all focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
            {tags.map((tag) => (
              <span key={tag} className="animate-fade flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {tag}
                <button type="button" aria-label={`Remove ${tag}`} onClick={() => setTags((t) => t.filter((x) => x !== tag))} className="text-subtle transition-colors hover:text-primary">
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={commitTag}
              maxLength={TAG_MAX}
              aria-label="Add a tag"
              placeholder={tags.length === 0 ? "Type a tag and press Enter…" : "Add tag…"}
              className="min-w-24 flex-1 bg-transparent text-xs text-primary placeholder:text-subtle focus:outline-none"
            />
          </div>
        </FormField>

        <FormField label="What members get">
          <p className="-mt-0.5 mb-2 text-[11px] text-subtle">These points show on the subscription screen in the app, the same for every plan.</p>
          <div className="flex flex-col gap-2.5">
            {points.map((point, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Check size={13} strokeWidth={3} />
                </span>
                <input
                  type="text"
                  value={point}
                  onChange={(e) => setPoints((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                  maxLength={POINT_MAX}
                  aria-label={`Point ${i + 1}`}
                  placeholder="e.g. Daily trade ideas with entry and exit levels"
                  className={inputCls()}
                />
                <button
                  type="button"
                  aria-label={`Remove point ${i + 1}`}
                  onClick={() => setPoints((prev) => (prev.length === 1 ? [""] : prev.filter((_, j) => j !== i)))}
                  className="shrink-0 text-subtle transition-colors hover:text-red-500"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPoints((prev) => [...prev, ""])}
              disabled={points.length >= POINTS_LIMIT}
              className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider py-2.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={15} />
              Add point
            </button>
          </div>
        </FormField>

        {managesPlans && (
          <FormField label="Plans & pricing">
            <p className="-mt-0.5 mb-2 text-[11px] text-subtle">Members pick one plan to subscribe. Changes apply to new purchases; members who already subscribed keep their access.</p>
            {plans === null ? (
              plansLoadError ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-divider px-4 py-3 text-sm text-muted">
                  <span>Could not load the plans.</span>
                  <button type="button" onClick={() => void loadPlans()} className="font-semibold text-primary hover:underline">Retry</button>
                </div>
              ) : (
                <p className="rounded-xl border border-divider px-4 py-3 text-sm text-muted">Loading plans…</p>
              )
            ) : (
              <div className="flex flex-col gap-3">
                {plans.map((plan, i) => {
                  const pm = perMonth(plan);
                  const durations = [...new Set([...DURATIONS, plan.durationMonths])].sort((a, b) => a - b);
                  return (
                    <div key={plan.key} className="rounded-xl border border-divider p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="flex items-center gap-2 text-xs font-bold text-primary">
                          <Wallet size={13} className="text-subtle" aria-hidden />
                          {plan.id ? plan.name : `New plan ${i + 1}`}
                        </span>
                        {plans.length > 1 && (
                          <button type="button" onClick={() => removePlan(plan.key)} className="text-xs font-semibold text-red-500 hover:underline">
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Duration" small>
                          <Select
                            value={String(plan.durationMonths)}
                            onChange={(v) => changeDuration(plan, Number(v))}
                            options={durations.map((d) => ({ value: String(d), label: `${d} month${d === 1 ? "" : "s"}` }))}
                            ariaLabel={`Duration of plan ${i + 1}`}
                            portal
                            searchable={false}
                            disabled={saving}
                            className="w-full"
                            triggerClassName={`${inputCls()} relative flex items-center text-left disabled:cursor-not-allowed disabled:opacity-60`}
                          />
                        </FormField>
                        <FormField label="Price before GST" small>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-subtle">₹</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={1}
                              step="any"
                              value={plan.price}
                              onChange={(e) => updatePlan(plan.key, { price: e.target.value })}
                              placeholder="999"
                              className={`${inputCls(plansError && !(Number(plan.price) > 0) ? plansError : undefined)} pl-8`}
                            />
                          </div>
                        </FormField>
                      </div>
                      <p className="mt-3 flex items-center justify-between text-xs text-muted">
                        <span>Per month price</span>
                        <span className="font-bold tabular-nums text-primary">{pm === null ? "—" : `${rupees(pm, 2)} /month`}</span>
                      </p>
                    </div>
                  );
                })}
                {plansError && <p role="alert" className="text-xs font-medium text-red-500">{plansError}</p>}
                <button
                  type="button"
                  onClick={addPlan}
                  className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider py-2.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary"
                >
                  <Plus size={15} />
                  Add plan
                </button>
              </div>
            )}
          </FormField>
        )}
      </form>
    </Modal>
  );
}
