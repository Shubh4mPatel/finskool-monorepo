"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, Crown, Eye, EyeOff, Lock, Pencil, Plus, Search, SearchX, Shield, ShieldCheck, Trash2, UserCog, UserPlus, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useIsSuperAdmin } from "@/lib/session";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import Select, { pillClass } from "@/components/ui/Select";
import { EmptyState, Skeleton, stagger, TH } from "@/components/admin/dashboard/Panel";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";
import { TabButton, focusRing } from "@/components/admin/inbox/InboxParts";
import { communityOptions, type MemberCommunity } from "@/components/admin/members/communities";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";

interface Community extends MemberCommunity {
  coverImageUrl: string | null;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  communityAccess: { id: string; name: string; slug: string }[];
}

type RoleTab = "all" | "super" | "scoped";

/** GET /api/v1/admin/admins — filtered on the server; `counts` ignore the role tab so every tab has its number. */
interface AdminListResponse {
  items: AdminUser[];
  counts: { all: number; super: number; scoped: number };
}

type AdminsResult = { query: string; error: boolean } & AdminListResponse;

const EMPTY_ADD_FORM = { name: "", email: "", phone: "", password: "", communityIds: [] as string[] };

/** Chips for choosing which communities an admin can manage — with select-all and a running count. */
function CommunityPicker({
  communities,
  selected,
  onChange,
}: {
  communities: Community[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const allSelected = communities.length > 0 && selected.length === communities.length;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-primary">Community Access</span>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : communities.map((c) => c.id))}
          className="text-xs font-bold text-accent transition-colors hover:text-primary"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Community access">
        {communities.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all duration-200 ${focusRing} ${
                on ? "border-accent bg-accent/10 text-accent" : "border-divider bg-white text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {on && <Check size={12} strokeWidth={3} className="animate-fade" aria-hidden />}
              {c.name}
            </button>
          );
        })}
      </div>
      <p className={`mt-2 text-[11px] font-medium ${selected.length === 0 ? "text-amber-700" : "text-muted"}`}>
        {selected.length === 0
          ? "Pick at least one community."
          : `${selected.length} of ${communities.length} communit${communities.length === 1 ? "y" : "ies"} selected.`}
      </p>
    </div>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        required
        minLength={8}
        autoComplete="new-password"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Min. 8 characters"
        className={`${inputCls()} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle transition-colors hover:text-primary"
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export default function RolesAdminsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const isSuperAdmin = useIsSuperAdmin();

  const [communities, setCommunities] = useState<Community[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [roleTab, setRoleTab] = useState<RoleTab>("all");

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const addFormId = useId();

  // Edit modal
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editIds, setEditIds] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editFormId = useId();

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The communities for the filter and the pickers — loaded once.
  useEffect(() => {
    if (isSuperAdmin !== true) return;
    let cancelled = false;
    api
      .get<Community[]>("/api/v1/admin/communities")
      .then((c) => !cancelled && setCommunities(c))
      .catch((err) => !cancelled && toast.error(err instanceof ApiError ? err.message : "Failed to load communities"));
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, toast]);

  // Search waits for a pause in typing so it isn't a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // The server does the filtering and the tab counts. The last response remembers which query it
  // answered, so while a new one is in flight the current rows stay up (dimmed) instead of blanking.
  const query = useMemo(() => {
    const params = new URLSearchParams({ role: roleTab });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (communityFilter) params.set("communityId", communityFilter);
    return params.toString();
  }, [roleTab, debouncedSearch, communityFilter]);

  const [result, setResult] = useState<AdminsResult | null>(null);

  useEffect(() => {
    // Only super admins can see this page; the API would answer everyone else with a 403.
    if (isSuperAdmin !== true) return;
    let cancelled = false;
    api
      .get<AdminListResponse>(`/api/v1/admin/admins?${query}`)
      .then((data) => !cancelled && setResult({ query, error: false, ...data }))
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof ApiError ? err.message : "Failed to load data");
        setResult((r) => ({ query, error: true, items: r?.items ?? [], counts: r?.counts ?? { all: 0, super: 0, scoped: 0 } }));
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, query, reloadTick, toast]);

  const refreshing = result !== null && result.query !== query;
  const status: "loading" | "ready" | "error" = result === null ? "loading" : result.error && !refreshing ? "error" : "ready";
  const displayed = result?.items ?? [];
  const counts = result?.counts;
  const hasFilters = !!(search.trim() || communityFilter || roleTab !== "all");

  function clearFilters() {
    setSearch("");
    setCommunityFilter("");
    setRoleTab("all");
  }

  function closeAdd() {
    setAddOpen(false);
    setAddForm(EMPTY_ADD_FORM);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setAddSubmitting(true);
    try {
      await api.post<AdminUser>("/api/v1/admin/admins", addForm);
      setReloadTick((t) => t + 1);
      setAddOpen(false);
      setAddForm(EMPTY_ADD_FORM);
      toast.success("Admin created successfully");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create admin");
    } finally {
      setAddSubmitting(false);
    }
  }

  function openEdit(admin: AdminUser) {
    setEditTarget(admin);
    setEditIds(admin.communityAccess.map((c) => c.id));
  }

  async function handleUpdateAccess(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSubmitting(true);
    try {
      await api.patch<AdminUser>(`/api/v1/admin/admins/${editTarget.id}`, { communityIds: editIds });
      setReloadTick((t) => t + 1);
      setEditTarget(null);
      toast.success("Admin access updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update access");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteClick(admin: AdminUser) {
    const ok = await confirm({
      title: "Delete Admin?",
      message: (
        <>
          This will remove <span className="font-semibold text-primary">{admin.name}</span> admin access immediately. Their account will be archived.
        </>
      ),
      confirmLabel: "Yes, Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(admin.id);
    try {
      await api.delete(`/api/v1/admin/admins/${admin.id}`);
      setReloadTick((t) => t + 1);
      toast.success("Admin removed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete admin");
    } finally {
      setDeletingId(null);
    }
  }

  if (isSuperAdmin === false) {
    return (
      <div className="flex max-w-xl rounded-2xl bg-white shadow-card">
        <EmptyState icon={<Lock size={20} />}>Only super admins can manage the team and their roles.</EmptyState>
      </div>
    );
  }

  const loading = isSuperAdmin === null || status === "loading";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="animate-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Roles &amp; Admins</p>
          <h1 className="font-display text-2xl font-bold text-primary">Team &amp; Role Management</h1>
          <p className="mt-1 text-sm text-muted">Manage admin accounts and their access levels. Super Admin access only.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
        >
          <Plus size={15} className="text-lime" />
          Add New Admin
        </button>
      </div>

      <section className="animate-enter rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "60ms" }}>
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-divider p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
              <Search size={15} className="shrink-0 text-subtle" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                aria-label="Search admins"
                className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
            <Select
              value={communityFilter}
              onChange={setCommunityFilter}
              ariaLabel="Community"
              options={[{ value: "", label: "All communities" }, ...communityOptions(communities)]}
              triggerClassName={`relative ${pillClass(!!communityFilter)} ${focusRing}`}
            />
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="animate-fade shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold text-accent transition-colors hover:text-primary">
                Clear filters
              </button>
            )}
          </div>

          <div role="group" aria-label="Show admins" className="flex w-fit max-w-full flex-wrap rounded-full bg-background p-1">
            <TabButton active={roleTab === "all"} label="All" count={counts?.all} onClick={() => setRoleTab("all")} />
            <TabButton active={roleTab === "super"} label="Super admins" count={counts?.super} onClick={() => setRoleTab("super")} />
            <TabButton active={roleTab === "scoped"} label="Community admins" count={counts?.scoped} onClick={() => setRoleTab("scoped")} />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading admins">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : status === "error" ? (
          <EmptyState icon={<SearchX size={20} />}>
            <span className="flex flex-col items-center gap-3">
              Couldn&apos;t load the team.
              <button
                onClick={() => { setResult(null); setReloadTick((t) => t + 1); }}
                className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
              >
                Retry
              </button>
            </span>
          </EmptyState>
        ) : displayed.length === 0 ? (
          <EmptyState icon={hasFilters ? <SearchX size={20} /> : <UserPlus size={20} />}>
            <span className="flex flex-col items-center gap-3">
              {hasFilters ? "No admins match these filters." : "No admins yet. Add your first team member."}
              {hasFilters && (
                <button onClick={clearFilters} className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent">
                  Clear filters
                </button>
              )}
            </span>
          </EmptyState>
        ) : (
          <div aria-busy={refreshing} className={`overflow-x-auto px-2 pb-2 pt-2 transition-opacity duration-300 ${refreshing ? "pointer-events-none opacity-50" : "opacity-100"}`}>
            <table className="w-full min-w-170 text-left text-sm">
              <thead>
                <tr className="bg-background">
                  <th scope="col" className={`${TH} rounded-l-xl`}>Admin</th>
                  <th scope="col" className={TH}>Email</th>
                  <th scope="col" className={TH}>Community Access</th>
                  <th scope="col" className={`${TH} rounded-r-xl`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((a, i) => {
                  const deleting = deletingId === a.id;
                  return (
                    <tr
                      key={a.id}
                      style={stagger(Math.min(i, 8), 0, 40)}
                      className={`animate-fade border-b border-divider/70 transition-colors last:border-0 hover:bg-background/60 ${deleting ? "pointer-events-none opacity-50" : ""}`}
                    >
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-3">
                          {a.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white" />
                          ) : (
                            <TintAvatar name={a.name} className="h-10 w-10" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-bold text-primary">{a.name}</p>
                            {a.isSuperAdmin ? (
                              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-primary">
                                <Crown size={10} aria-hidden /> Super Admin
                              </span>
                            ) : (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted">
                                <Shield size={11} aria-hidden /> Community admin
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-3.5 text-muted">{a.email}</td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {a.isSuperAdmin ? (
                            // Super admins aren't limited to a list of communities — they can manage all of them.
                            <span className="rounded-full bg-lime/40 px-2.5 py-1 text-[11px] font-bold text-primary">All communities</span>
                          ) : a.communityAccess.length === 0 ? (
                            <span className="text-xs text-subtle">No access</span>
                          ) : (
                            <>
                              {a.communityAccess.slice(0, 3).map((c) => (
                                <span key={c.id} className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold text-accent">
                                  {c.name}
                                </span>
                              ))}
                              {a.communityAccess.length > 3 && (
                                <span
                                  className="rounded-full bg-divider px-2.5 py-1 text-[11px] font-bold text-muted"
                                  title={a.communityAccess.slice(3).map((c) => c.name).join(", ")}
                                >
                                  +{a.communityAccess.length - 3}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(a)}
                            disabled={a.isSuperAdmin}
                            title={a.isSuperAdmin ? "Super admins can manage every community" : "Edit access"}
                            aria-label={`Edit access for ${a.name}`}
                            className={`${iconBtn} hover:bg-divider/60 hover:text-accent`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(a)}
                            disabled={a.isSuperAdmin || deleting}
                            title={a.isSuperAdmin ? "Super admins can't be deleted here" : "Delete admin"}
                            aria-label={`Delete ${a.name}`}
                            className={`${iconBtn} hover:bg-red-50 hover:text-red-500`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {status === "ready" && displayed.length > 0 && (
          <div className="border-t border-divider px-5 py-4 text-sm text-muted">
            Showing <span className="font-semibold tabular-nums text-primary">{displayed.length}</span> admin{displayed.length === 1 ? "" : "s"}
          </div>
        )}
      </section>

      {/* Add Admin */}
      {addOpen && (
        <Modal
          title="Add New Admin"
          subtitle="They can sign in to the admin panel right away."
          icon={<UserPlus size={18} />}
          onClose={closeAdd}
          busy={addSubmitting}
          footer={
            <>
              <button type="button" onClick={closeAdd} disabled={addSubmitting} className={secondaryBtn}>Cancel</button>
              <button type="submit" form={addFormId} disabled={addSubmitting || addForm.communityIds.length === 0} className={primaryBtn}>
                {addSubmitting ? "Creating…" : "Create Admin"}
              </button>
            </>
          }
        >
          <form id={addFormId} onSubmit={handleCreate} className="flex flex-col gap-4">
            <FormField label="Name">
              <input required autoFocus value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} className={inputCls()} placeholder="Full name" />
            </FormField>
            <FormField label="Email">
              <input required type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} className={inputCls()} placeholder="admin@example.com" />
            </FormField>
            <FormField label="Phone">
              <input required type="tel" value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls()} placeholder="+91 XXXXX XXXXX" />
            </FormField>
            <FormField label="Password">
              <PasswordField value={addForm.password} onChange={(password) => setAddForm((f) => ({ ...f, password }))} />
            </FormField>
            <CommunityPicker communities={communities} selected={addForm.communityIds} onChange={(communityIds) => setAddForm((f) => ({ ...f, communityIds }))} />
          </form>
        </Modal>
      )}

      {/* Edit Access */}
      {editTarget && (
        <Modal
          title="Edit Access"
          subtitle={editTarget.name}
          icon={<UserCog size={18} />}
          onClose={() => setEditTarget(null)}
          busy={editSubmitting}
          footer={
            <>
              <button type="button" onClick={() => setEditTarget(null)} disabled={editSubmitting} className={secondaryBtn}>Cancel</button>
              <button type="submit" form={editFormId} disabled={editSubmitting || editIds.length === 0} className={primaryBtn}>
                {editSubmitting ? "Saving…" : "Save Changes"}
              </button>
            </>
          }
        >
          <form id={editFormId} onSubmit={handleUpdateAccess} className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl bg-background px-3.5 py-3">
              <TintAvatar name={editTarget.name} className="h-10 w-10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-primary">{editTarget.name}</p>
                <p className="truncate text-xs text-muted">{editTarget.email}</p>
              </div>
              <ShieldCheck size={16} className="ml-auto shrink-0 text-accent" aria-hidden />
            </div>
            <CommunityPicker communities={communities} selected={editIds} onChange={setEditIds} />
          </form>
        </Modal>
      )}
    </div>
  );
}
