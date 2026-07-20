"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, X, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { getSession } from "@/lib/session";
import CommunityCoverImageUploader from "@/components/admin/CommunityCoverImageUploader";

interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  tags: string[];
  coverImageUrl: string | null;
  memberCount: number;
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function CreateCommunityModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Community) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function addTag(e: React.KeyboardEvent) {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      setTags((prev) => [...prev, tagInput.trim()]);
      setTagInput("");
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<Community>("/api/v1/admin/communities", {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        tags,
        coverImageUrl: coverImageUrl ?? undefined,
      });
      toast.success("Community created.");
      onCreated(created);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create community");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col gap-5 rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-primary">Create Community</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Swing Alpha"
            className="w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="auto-generated-from-name"
            className="w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this community about?"
            className="w-full rounded-xl border border-divider bg-background px-4 py-2.5 text-sm text-primary placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Tags</label>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-divider bg-background px-3 py-2.5 focus-within:border-accent transition-colors">
            {tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-divider/60 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {tag}
                <button type="button" onClick={() => setTags((t) => t.filter((x) => x !== tag))} className="text-subtle hover:text-primary">
                  <X size={9} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={addTag}
              placeholder="Add tag…"
              className="min-w-24 flex-1 bg-transparent text-xs text-subtle focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">Cover Image</label>
          <CommunityCoverImageUploader coverImageUrl={coverImageUrl} onChange={setCoverImageUrl} />
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check size={14} />
            {saving ? "Creating…" : "Create Community"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunitiesPage() {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    setIsSuperAdmin(getSession()?.isSuperAdmin ?? false);
  }, []);

  useEffect(() => {
    api
      .get<Community[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Communities</p>
          <h1 className="font-display text-2xl font-bold text-primary">Communities</h1>
          <p className="mt-1 text-sm text-muted">All communities across the platform.</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-all duration-300 hover:scale-105 active:scale-95"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            <Plus size={15} />
            Create Community
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading communities…</p>
      ) : communities.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-card">
          <Building2 className="mx-auto text-subtle" size={32} />
          <p className="mt-3 text-sm text-muted">No communities yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {communities.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-2xl bg-white shadow-card">
              <div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100">
                {c.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.coverImageUrl} alt={c.name} className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="text-subtle" size={28} />
                )}
              </div>
              <div className="p-4">
                <p className="font-display font-bold text-primary">{c.name}</p>
                <p className="text-xs text-subtle">/{c.slug}</p>
                {c.description && <p className="mt-1.5 line-clamp-2 text-xs text-muted">{c.description}</p>}
                {c.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-divider/60 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <span className="mt-3 inline-block rounded-full bg-lime/40 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateCommunityModal
          onClose={() => setShowCreate(false)}
          onCreated={(created) => setCommunities((prev) => [created, ...prev])}
        />
      )}
    </div>
  );
}
