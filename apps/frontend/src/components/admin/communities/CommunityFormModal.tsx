"use client";

import { useId, useState } from "react";
import { Building2, Lock, X } from "lucide-react";
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
  const [description, setDescription] = useState(community?.description ?? "");
  const [tags, setTags] = useState<string[]>(community?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
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
          tags,
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
          tags,
          coverImageUrl: coverImageUrl ?? undefined,
          badgeUrl: badgeUrl ?? undefined,
          paymentLink: paymentLink.trim() || undefined,
        });
        toast.success("Community created.");
        onSaved(created);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Failed to ${editing ? "update" : "create"} community`);
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
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={nameError}>
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
        </div>

        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="What is this community about?"
            className={`${inputCls()} resize-none`}
          />
          {description.length > DESCRIPTION_MAX * 0.8 && (
            <span className="mt-1 block text-right text-[11px] tabular-nums text-subtle">{description.length}/{DESCRIPTION_MAX}</span>
          )}
        </FormField>

        <FormField label="Tags">
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

        <FormField label="Payment Link">
          <input
            type="url"
            value={paymentLink}
            onChange={(e) => setPaymentLink(e.target.value)}
            placeholder="https://razorpay.me/@yourcommunity"
            className={inputCls()}
          />
        </FormField>

        <FormField label="Cover Image">
          <CommunityCoverImageUploader coverImageUrl={coverImageUrl} onChange={setCoverImageUrl} />
        </FormField>

        <FormField label="Badge (shown next to the community name everywhere)">
          <CommunityBadgeUploader badgeUrl={badgeUrl} onChange={setBadgeUrl} />
        </FormField>
      </form>
    </Modal>
  );
}
