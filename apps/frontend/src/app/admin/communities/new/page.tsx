"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ListChecks, Plus, Tag, Trash2, Wallet, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useIsSuperAdmin } from "@/lib/session";
import Stepper from "@/components/admin/Stepper";
import CommunityCoverImageUploader from "@/components/admin/CommunityCoverImageUploader";
import CommunityBadgeUploader from "@/components/admin/CommunityBadgeUploader";
import { FormField, inputCls } from "@/components/admin/members/memberUi";
import type { Community } from "@/components/admin/communities/types";

// Limits mirror the backend's community and plan schemas.
const NAME_MAX = 150;
const TYPE_MAX = 50;
const DESCRIPTION_MAX = 2000;
const TAG_MAX = 50;
const POINT_MAX = 200;
const POINTS_LIMIT = 20;
const DURATIONS = [1, 3, 6, 12, 24];

const STEPS = ["Community details", "Review & create"];

interface PlanDraft {
  key: number;
  durationMonths: number;
  price: string;
}

const rupees = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const planName = (months: number) => `${months} Month${months === 1 ? "" : "s"}`;
const perMonth = (p: PlanDraft) => {
  const price = Number(p.price);
  return price > 0 ? price / p.durationMonths : null;
};

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="animate-enter rounded-2xl bg-white p-6 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-primary">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function AddCommunityPage() {
  const router = useRouter();
  const toast = useToast();
  const isSuperAdmin = useIsSuperAdmin();

  const [step, setStep] = useState<1 | 2>(1);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [points, setPoints] = useState<string[]>([""]);
  const [plans, setPlans] = useState<PlanDraft[]>([{ key: 1, durationMonths: 1, price: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const [errors, setErrors] = useState<{ name?: string; points?: string; plans?: string }>({});
  const [saving, setSaving] = useState(false);

  // Only a super admin can create communities; anyone else is sent back to the list.
  useEffect(() => {
    if (isSuperAdmin === false) router.replace("/admin/communities");
  }, [isSuperAdmin, router]);

  function commitTag() {
    const t = tagInput.trim().replace(/,$/, "").trim();
    setTagInput("");
    if (!t) return;
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

  function addPlan() {
    // Default the new plan to the first duration not used yet.
    const free = DURATIONS.find((d) => !plans.some((p) => p.durationMonths === d)) ?? DURATIONS[0]!;
    setPlans((prev) => [...prev, { key: nextKey, durationMonths: free, price: "" }]);
    setNextKey((k) => k + 1);
  }

  const updatePlan = (key: number, patch: Partial<PlanDraft>) =>
    setPlans((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  function validate(): boolean {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Name is required";
    if (plans.length === 0) {
      next.plans = "Add at least one plan";
    } else if (plans.some((p) => !(Number(p.price) > 0))) {
      next.plans = "Every plan needs a price above ₹0";
    } else if (new Set(plans.map((p) => p.durationMonths)).size !== plans.length) {
      next.plans = "Each plan needs a different duration";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validate()) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleCreate() {
    if (!validate()) {
      setStep(1);
      return;
    }
    setSaving(true);
    let created: Community;
    try {
      created = await api.post<Community>("/api/v1/admin/communities", {
        name: name.trim(),
        description: description.trim() || undefined,
        type: type.trim() || undefined,
        tags,
        whatsIncluded: cleanPoints,
        coverImageUrl: coverImageUrl ?? undefined,
        badgeUrl: badgeUrl ?? undefined,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "COMMUNITY_NAME_EXISTS") {
        setErrors((x) => ({ ...x, name: err.message }));
        setStep(1);
      } else {
        toast.error(err instanceof ApiError ? err.message : "Failed to create community");
      }
      setSaving(false);
      return;
    }

    // The community now exists, so a plan that fails must not lose it: report it and go to the list.
    const failed: number[] = [];
    for (const p of [...plans].sort((a, b) => a.durationMonths - b.durationMonths)) {
      try {
        await api.post(`/api/v1/admin/communities/${created.id}/plans`, {
          name: planName(p.durationMonths),
          durationMonths: p.durationMonths,
          price: Number(p.price),
        });
      } catch {
        failed.push(p.durationMonths);
      }
    }
    if (failed.length > 0) {
      toast.error(`"${created.name}" was created, but these plans could not be added: ${failed.map(planName).join(", ")}. Add them again from the community.`);
    } else {
      toast.success("Community created.");
    }
    router.push("/admin/communities");
  }

  const cheapestPerMonth = Math.min(...plans.map((p) => perMonth(p) ?? Infinity));

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter">
        <p className="text-xs font-semibold text-accent">Admin Panel &rsaquo; Add Communities</p>
        <h1 className="font-display text-2xl font-bold text-primary">Add Community</h1>
        <p className="mt-1 text-sm text-muted">Set up a new home base for your members.</p>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="animate-enter rounded-2xl bg-white p-6 shadow-card" style={{ animationDelay: "60ms" }}>
          <Stepper steps={STEPS} current={step} />
        </div>

        {step === 1 && (
          <>
            <Section icon={<Tag size={16} />} title="Community details">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  <CommunityCoverImageUploader large coverImageUrl={coverImageUrl} onChange={setCoverImageUrl} />
                  <CommunityBadgeUploader large noun="Icon" badgeUrl={badgeUrl} onChange={setBadgeUrl} />
                  <p className="text-[11px] text-subtle">The icon is a small SVG shown next to the community name in the app and on the web.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Community name" error={errors.name}>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setErrors((x) => ({ ...x, name: undefined }));
                      }}
                      maxLength={NAME_MAX}
                      placeholder="e.g. Swing Alpha"
                      className={inputCls(errors.name)}
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

              </div>
            </Section>

            <Section icon={<ListChecks size={16} />} title="What members get" hint="These points show on the subscription screen in the app, the same for every plan.">
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
            </Section>

            <Section icon={<Wallet size={16} />} title="Plans & pricing" hint="Members pick one plan to subscribe. Buying again before expiry extends their access.">
              <div className="flex flex-col gap-4">
                {plans.map((plan, i) => {
                  const pm = perMonth(plan);
                  const best = plans.length > 1 && pm !== null && pm === cheapestPerMonth;
                  return (
                    <div key={plan.key} className={`rounded-xl border p-4 transition-colors ${best ? "border-accent/40 bg-accent/5" : "border-divider"}`}>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="flex items-center gap-2 text-xs font-bold text-primary">
                          Plan {i + 1}
                          {best && <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-extrabold text-primary">Best value</span>}
                        </span>
                        {plans.length > 1 && (
                          <button type="button" onClick={() => setPlans((prev) => prev.filter((p) => p.key !== plan.key))} className="text-xs font-semibold text-red-500 hover:underline">
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Duration" small>
                          <select
                            value={plan.durationMonths}
                            onChange={(e) => {
                              updatePlan(plan.key, { durationMonths: Number(e.target.value) });
                              setErrors((x) => ({ ...x, plans: undefined }));
                            }}
                            className={inputCls()}
                          >
                            {DURATIONS.map((d) => (
                              <option key={d} value={d}>{d} month{d === 1 ? "" : "s"}</option>
                            ))}
                          </select>
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
                              onChange={(e) => {
                                updatePlan(plan.key, { price: e.target.value });
                                setErrors((x) => ({ ...x, plans: undefined }));
                              }}
                              placeholder="999"
                              className={`${inputCls(errors.plans && !(Number(plan.price) > 0) ? errors.plans : undefined)} pl-8`}
                            />
                          </div>
                        </FormField>
                      </div>
                      <p className="mt-3 flex items-center justify-between text-xs text-muted">
                        <span>Per month price</span>
                        <span className="font-bold tabular-nums text-primary">{pm === null ? "—" : `${rupees(pm)} /month`}</span>
                      </p>
                    </div>
                  );
                })}

                {errors.plans && (
                  <p role="alert" className="text-xs font-medium text-red-500">{errors.plans}</p>
                )}

                <button
                  type="button"
                  onClick={addPlan}
                  className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider py-2.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary"
                >
                  <Plus size={15} />
                  Add plan
                </button>
              </div>
            </Section>
          </>
        )}

        {step === 2 && (
          <Section icon={<Check size={16} />} title="Review & create" hint="Check everything below. You can edit the details later, but plans are managed separately.">
            <div className="flex flex-col gap-5">
              <div className="overflow-hidden rounded-xl border border-divider">
                {coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverImageUrl} alt="Thumbnail" className="aspect-[5/2] w-full object-cover" />
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2.5">
                    {badgeUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={badgeUrl} alt="Icon" className="h-6 w-6 shrink-0" />
                    )}
                    <h3 className="font-display text-lg font-bold text-primary">{name.trim()}</h3>
                  </div>
                  {type.trim() && <p className="text-xs font-semibold text-accent">{type.trim()}</p>}
                  {description.trim() && <p className="mt-2 text-sm leading-relaxed text-muted">{description.trim()}</p>}
                  {tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <span key={t} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-primary">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {cleanPoints.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-primary">What members get</h4>
                  <ul className="mt-2 flex flex-col gap-2">
                    {cleanPoints.map((p, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-muted">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                          <Check size={11} strokeWidth={3} />
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-primary">Plans</h4>
                <ul className="mt-2 divide-y divide-divider rounded-xl border border-divider">
                  {[...plans].sort((a, b) => a.durationMonths - b.durationMonths).map((p) => (
                    <li key={p.key} className="flex items-center justify-between px-4 py-3 text-sm">
                      <span className="font-semibold text-primary">{planName(p.durationMonths)}</span>
                      <span className="text-right">
                        <span className="block font-bold tabular-nums text-primary">{rupees(Number(p.price))}</span>
                        <span className="block text-[11px] tabular-nums text-muted">{rupees(perMonth(p) ?? 0)} /month</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        )}

        <div className="flex items-center justify-end gap-3 pb-6">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={() => router.push("/admin/communities")}
                className="rounded-full border border-divider bg-white px-6 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
              >
                Continue
                <ArrowRight size={15} className="text-lime" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={saving}
                className="flex items-center gap-2 rounded-full border border-divider bg-white px-6 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50"
              >
                <ArrowLeft size={15} />
                Back
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving}
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {saving ? "Creating…" : "Create Community"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
