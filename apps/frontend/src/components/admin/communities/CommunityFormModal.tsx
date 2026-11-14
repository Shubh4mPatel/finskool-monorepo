"use client";

import { useId, useState } from "react";
import { Building2, Check, Lock, Plus, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import CommunityCoverImageUploader from "@/components/admin/CommunityCoverImageUploader";
import CommunityBadgeUploader from "@/components/admin/CommunityBadgeUploader";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";
import { slugify, type Community } from "./types";

// Limits mirror the backend's community schema.
const NAME_MAX = 150;
const DESCRIPTION_MAX = 2000;
const TAG_MAX = 50;
const TYPE_MAX = 50;
const POINT_MAX = 200;
const POINTS_LIMIT = 20;

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
  const [paymentLink, setPaymentLink] = useState(community?.paymentLink ?? "");
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

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
          paymentLink: paymentLink.trim() || undefined,
        });
        toast.success("Community updated.");
        onSaved(updated);
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
          paymentLink: paymentLink.trim() || undefined,
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

        <FormField label="Payment Link">
          <input
            type="url"
            value={paymentLink}
            onChange={(e) => setPaymentLink(e.target.value)}
            placeholder="https://razorpay.me/@yourcommunity"
            className={inputCls()}
          />
        </FormField>
      </form>
    </Modal>
  );
}
