"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Community {
  id: string;
  name: string;
  slug: string;
  coverImageUrl: string | null;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  communityAccess: { id: string; name: string; slug: string }[];
}

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "?";
}

const EMPTY_ADD_FORM = { name: "", email: "", phone: "", password: "", communityIds: [] as string[] };

export default function RolesAdminsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editIds, setEditIds] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Delete
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<AdminUser[]>("/api/v1/admin/admins"),
      api.get<Community[]>("/api/v1/admin/communities"),
    ])
      .then(([a, c]) => {
        setAdmins(a);
        setCommunities(c);
      })
      .catch(err => {
        toast.error(err instanceof ApiError ? err.message : "Failed to load data");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayed = admins.filter(a => {
    const q = search.toLowerCase();
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
    const matchesCommunity = !communityFilter || a.communityAccess.some(c => c.id === communityFilter);
    return matchesSearch && matchesCommunity;
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setAddSubmitting(true);
    try {
      const created = await api.post<AdminUser>("/api/v1/admin/admins", addForm);
      setAdmins(prev => [...prev, created]);
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
    setEditIds(admin.communityAccess.map(c => c.id));
  }

  async function handleUpdateAccess(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSubmitting(true);
    try {
      const updated = await api.patch<AdminUser>(`/api/v1/admin/admins/${editTarget.id}`, { communityIds: editIds });
      setAdmins(prev => prev.map(a => (a.id === updated.id ? updated : a)));
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
          This will remove{" "}
          <span className="font-semibold text-primary">{admin.name}</span> admin access
          immediately. Their account will be archived.
        </>
      ),
      confirmLabel: "Yes, Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleteSubmitting(true);
    try {
      await api.delete(`/api/v1/admin/admins/${admin.id}`);
      setAdmins(prev => prev.filter(a => a.id !== admin.id));
      toast.success("Admin removed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete admin");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function toggleId(id: string, ids: string[], setIds: (v: string[]) => void) {
    setIds(ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Admin Panel</p>
          <h1 className="font-display text-2xl font-bold text-primary">Team & Role Management</h1>
          <p className="mt-1 text-sm text-muted">Manage admin accounts and their access levels. Super Admin access only.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 rounded-full bg-linear-to-r from-accent to-primary px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95"
        >
          <Plus size={14} />
          Add New Admin
        </button>
      </div>

      {/* Table card */}
      <div className="rounded-2xl bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-divider px-4 py-2 transition-colors focus-within:border-accent">
            <Search size={15} className="shrink-0 text-subtle" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
            />
          </div>
          <select
            value={communityFilter}
            onChange={e => setCommunityFilter(e.target.value)}
            className="rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary focus:outline-none"
          >
            <option value="">All Communities</option>
            {communities.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="mt-4 overflow-x-auto">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted">Loading...</p>
          ) : (
            <table className="w-full min-w-150 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase text-subtle">
                  <th className="px-3 py-3">Admin</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Community Access</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted">
                      No admins found
                    </td>
                  </tr>
                ) : (
                  displayed.map(a => (
                    <tr key={a.id} className="border-t border-divider transition-colors hover:bg-background">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-accent to-primary text-xs font-bold text-lime">
                            {getInitials(a.name)}
                          </div>
                          <div>
                            <p className="font-semibold text-primary">{a.name}</p>
                            {a.isSuperAdmin && (
                              <span className="text-xs font-bold text-accent">Super Admin</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">{a.email}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {a.communityAccess.length === 0 ? (
                            <span className="text-xs text-subtle">No access</span>
                          ) : (
                            a.communityAccess.map(c => (
                              <span
                                key={c.id}
                                className="rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent"
                              >
                                {c.name}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(a)}
                            disabled={a.isSuperAdmin}
                            title="Edit access"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(a)}
                            disabled={a.isSuperAdmin || deleteSubmitting}
                            title="Delete admin"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Admin Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Add New Admin</h3>
              <button
                type="button"
                onClick={() => { setAddOpen(false); setAddForm(EMPTY_ADD_FORM); }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted">Name</label>
                <input
                  required
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  className="rounded-xl border border-divider px-4 py-2.5 text-sm text-primary focus:border-accent focus:outline-none"
                  placeholder="Full name"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted">Email</label>
                <input
                  required
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  className="rounded-xl border border-divider px-4 py-2.5 text-sm text-primary focus:border-accent focus:outline-none"
                  placeholder="admin@example.com"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted">Phone</label>
                <input
                  required
                  type="tel"
                  value={addForm.phone}
                  onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
                  className="rounded-xl border border-divider px-4 py-2.5 text-sm text-primary focus:border-accent focus:outline-none"
                  placeholder="+91 XXXXX XXXXX"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted">Password</label>
                <input
                  required
                  type="password"
                  value={addForm.password}
                  onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                  className="rounded-xl border border-divider px-4 py-2.5 text-sm text-primary focus:border-accent focus:outline-none"
                  placeholder="Min. 8 characters"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted">Community Access</label>
                <div className="flex flex-wrap gap-2">
                  {communities.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        toggleId(c.id, addForm.communityIds, ids =>
                          setAddForm(f => ({ ...f, communityIds: ids })),
                        )
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                        addForm.communityIds.includes(c.id)
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-divider text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setAddOpen(false); setAddForm(EMPTY_ADD_FORM); }}
                  className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSubmitting || addForm.communityIds.length === 0}
                  className="flex-1 rounded-full bg-linear-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-60"
                >
                  {addSubmitting ? "Creating..." : "Create Admin"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Access Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-primary">Edit Access</h3>
                <p className="text-sm text-muted">{editTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleUpdateAccess} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted">Community Access</label>
                <div className="flex flex-wrap gap-2">
                  {communities.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleId(c.id, editIds, setEditIds)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                        editIds.includes(c.id)
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-divider text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting || editIds.length === 0}
                  className="flex-1 rounded-full bg-linear-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-60"
                >
                  {editSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
