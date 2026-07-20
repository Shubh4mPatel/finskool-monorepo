"use client";

import { useEffect, useState } from "react";
import { Ban, Download, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface MemberSubscription {
  id: string;
  communityId: string;
  communityName: string;
  payment: number;
  paidOn: string | null;
  validUntil: string;
  isActive: boolean;
}

interface MemberItem {
  id: string;
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
  isRegistered: boolean;
  status: "registered" | "pending" | "expired" | "suspended";
  createdAt: string;
  suspensionReason: string | null;
  subscription: MemberSubscription | null;
  allSubscriptions: MemberSubscription[];
}

interface MemberList {
  members: MemberItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STATUS_STYLES: Record<string, string> = {
  registered: "bg-accent/10 text-accent",
  pending: "bg-amber-100 text-amber-600",
  expired: "bg-red-100 text-red-500",
  suspended: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  registered: "Registered",
  pending: "Pending Sign",
  expired: "Expired",
  suspended: "Suspended",
};

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "?";
}

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function communityBadge(name: string): string {
  const colors = ["bg-lime/40 text-primary", "bg-accent/10 text-accent", "bg-amber-100 text-amber-600"];
  return colors[name.charCodeAt(0) % colors.length] ?? "bg-divider text-muted";
}

function getPaginationPages(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, null, total];
  if (current >= total - 3) return [1, null, total - 4, total - 3, total - 2, total - 1, total];
  return [1, null, current - 1, current, current + 1, null, total];
}

type ModalType = "add" | "edit" | "extend" | "suspend" | null;

interface Community { id: string; name: string; slug: string }

const EMPTY_MEMBER = { name: "", phone: "", email: "", communityId: "", payment: "", validUntil: "" };
type MemberField = keyof typeof EMPTY_MEMBER;
type MemberErrors = Partial<Record<MemberField, string>>;

function validateMember(m: typeof EMPTY_MEMBER): MemberErrors {
  const e: MemberErrors = {};
  if (m.name.trim().length < 2) e.name = "Name must be at least 2 characters";
  const digits = m.phone.replace(/\D/g, "");
  if (!digits) e.phone = "Phone is required";
  else if (digits.length !== 10 && !(digits.length === 12 && digits.startsWith("91")))
    e.phone = "Enter a valid 10-digit phone number";
  if (!m.email) e.email = "Email is required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) e.email = "Invalid email address";
  if (!m.communityId) e.communityId = "Select a community";
  const amt = parseFloat(m.payment);
  if (!m.payment || isNaN(amt) || amt <= 0) e.payment = "Enter a valid payment amount";
  if (!m.validUntil) e.validUntil = "Valid till date is required";
  return e;
}

export default function MembersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [modal, setModal] = useState<ModalType>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [extendDate, setExtendDate] = useState("");
  const [extendPayment, setExtendPayment] = useState("");
  const [extendErrors, setExtendErrors] = useState<{ payment?: string; extendDate?: string }>({});
  const [extending, setExtending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Edit member
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "" });
  const [editNewCom, setEditNewCom] = useState({ communityId: "", payment: "", paidOn: "", validUntil: "" });
  const [showAddCom, setShowAddCom] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editErrors, setEditErrors] = useState<Partial<Record<string, string>>>({});

  // Revoke community
  const [revokingCommunity, setRevokingCommunity] = useState(false);

  // Communities
  const [communities, setCommunities] = useState<Community[]>([]);

  // Members list
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Stats (independent of filters)
  const [statsData, setStatsData] = useState({ total: 0, registered: 0, pending: 0 });

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCommunity, setFilterCommunity] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [validDate, setValidDate] = useState("");
  const [paidDate, setPaidDate] = useState("");

  // Add member form
  const [newMember, setNewMember] = useState(EMPTY_MEMBER);
  const [memberErrors, setMemberErrors] = useState<MemberErrors>({});
  const [memberTouched, setMemberTouched] = useState<Partial<Record<MemberField, boolean>>>({});
  const [addingMember, setAddingMember] = useState(false);

  useEffect(() => {
    api.get<Community[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when any filter changes
  useEffect(() => {
    setPage(1);
  }, [filterCommunity, filterStatus, validDate, paidDate, debouncedSearch]);

  // Fetch members list
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "8" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterCommunity) params.set("communityId", filterCommunity);
    if (filterStatus) params.set("status", filterStatus);
    if (validDate) params.set("validTo", validDate);
    if (paidDate) { params.set("paidFrom", paidDate); params.set("paidTo", paidDate); }

    setLoading(true);
    setSelectedIds(new Set());
    api.get<MemberList>(`/api/v1/admin/members?${params.toString()}`)
      .then(data => {
        setMembers(data.members);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      })
      .catch(err => toast.error(err instanceof ApiError ? err.message : "Failed to load members"))
      .finally(() => setLoading(false));
  // toast is a stable context ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, filterCommunity, filterStatus, validDate, paidDate, fetchTrigger]);

  // Fetch summary stats (unfiltered)
  useEffect(() => {
    Promise.all([
      api.get<MemberList>("/api/v1/admin/members?page=1&pageSize=1"),
      api.get<MemberList>("/api/v1/admin/members?page=1&pageSize=1&status=registered"),
      api.get<MemberList>("/api/v1/admin/members?page=1&pageSize=1&status=pending"),
    ]).then(([all, reg, pend]) => {
      setStatsData({ total: all.total, registered: reg.total, pending: pend.total });
    }).catch(() => {});
  }, [fetchTrigger]);

  const refresh = () => setFetchTrigger(t => t + 1);

  const close = () => {
    setModal(null);
    setNewMember(EMPTY_MEMBER);
    setMemberErrors({});
    setMemberTouched({});
    setSelectedMember(null);
    setExtendDate("");
    setExtendPayment("");
    setExtendErrors({});
    setSuspendReason("");
    setEditForm({ name: "", phone: "", email: "" });
    setEditNewCom({ communityId: "", payment: "", paidOn: "", validUntil: "" });
    setShowAddCom(false);
    setEditErrors({});
  };

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelectedOnPage = members.length > 0 && members.every(m => selectedIds.has(m.id));

  function toggleSelectAll() {
    setSelectedIds(prev => {
      if (allSelectedOnPage) {
        const next = new Set(prev);
        members.forEach(m => next.delete(m.id));
        return next;
      }
      const next = new Set(prev);
      members.forEach(m => next.add(m.id));
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const ok = await confirm({
      title: `Deactivate ${selectedIds.size} Member${selectedIds.size === 1 ? "" : "s"}?`,
      message: "They'll be logged out and won't be able to sign in again. Their posts and comments will remain visible. This can't be undone from here.",
      confirmLabel: "Yes, Deactivate",
      variant: "destructive",
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await api.post<{ total: number; succeeded: number; failed: number }>(
        "/api/v1/admin/members/bulk-delete",
        { approvedPhoneIds: ids },
      );
      if (result.failed > 0) {
        toast.error(`Deactivated ${result.succeeded} of ${result.total} members — ${result.failed} failed.`);
      } else {
        toast.success({ title: "Members deactivated", message: `${result.succeeded} member(s) no longer have access.` });
      }
      exitSelectMode();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to bulk delete members");
    } finally {
      setBulkDeleting(false);
    }
  }

  function openSuspendModal(m: MemberItem) {
    setSelectedMember(m);
    setSuspendReason("");
    setModal("suspend");
  }

  async function handleSuspendMember() {
    if (!selectedMember) return;
    if (!suspendReason.trim()) {
      toast.error("Please provide a reason for suspension");
      return;
    }
    setSuspending(true);
    try {
      await api.patch(`/api/v1/admin/members/${selectedMember.id}/suspend`, { reason: suspendReason.trim() });
      toast.success({ title: "Member suspended", message: `${selectedMember.name} can no longer sign in.` });
      close();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to suspend member");
    } finally {
      setSuspending(false);
    }
  }

  async function handleRevokeSuspension(m: MemberItem) {
    const ok = await confirm({
      title: "Revoke Suspension?",
      message: (
        <>
          This will restore {m.name}&rsquo;s access and let them sign in again.
          {m.suspensionReason && (
            <> Suspended for: <span className="italic">&ldquo;{m.suspensionReason}&rdquo;</span></>
          )}
        </>
      ),
      confirmLabel: "Yes, Revoke",
      variant: "positive",
    });
    if (!ok) return;
    setRevoking(true);
    try {
      await api.patch(`/api/v1/admin/members/${m.id}/revoke`, {});
      toast.success({ title: "Suspension revoked", message: `${m.name} can sign in again.` });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke suspension");
    } finally {
      setRevoking(false);
    }
  }

  async function handleDeleteMember(m: MemberItem) {
    const ok = await confirm({
      title: "Deactivate Member?",
      message: `This will revoke ${m.name}'s access — they'll be logged out and won't be able to sign in again. Their posts and comments will remain visible. This can't be undone from here.`,
      confirmLabel: "Yes, Deactivate",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.delete(`/api/v1/admin/members/${m.id}`);
      toast.success({
        title: "Member deactivated",
        message: `${m.name} no longer has access to the platform.`,
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to deactivate member");
    } finally {
      setDeleting(false);
    }
  }

  function openExtendModal(m: MemberItem) {
    if (!m.subscription) {
      toast.error("This member has no subscription to extend");
      return;
    }
    setSelectedMember(m);
    setExtendDate("");
    setExtendPayment(String(m.subscription.payment));
    setExtendErrors({});
    setModal("extend");
  }

  function validateExtend(payment: string, validUntil: string): { payment?: string; extendDate?: string } {
    const errs: { payment?: string; extendDate?: string } = {};
    const amt = parseFloat(payment);
    if (!payment || isNaN(amt) || amt <= 0) errs.payment = "Enter a valid payment amount";
    if (!validUntil) errs.extendDate = "Extend date is required";
    else if (new Date(validUntil) <= new Date()) errs.extendDate = "Extend date must be in the future";
    return errs;
  }

  async function handleExtendSubscription() {
    if (!selectedMember?.subscription) return;
    const errs = validateExtend(extendPayment, extendDate);
    setExtendErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setExtending(true);
    try {
      await api.post(`/api/v1/admin/subscriptions/${selectedMember.subscription.id}/extend`, {
        validUntil: extendDate,
        payment: parseFloat(extendPayment),
      });
      toast.success({
        title: "Subscription extended",
        message: `${selectedMember.name}'s subscription is now valid until ${formatDate(extendDate)}`,
      });
      close();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to extend subscription");
    } finally {
      setExtending(false);
    }
  }

  function blurMemberField(field: MemberField) {
    setMemberTouched(t => ({ ...t, [field]: true }));
    setMemberErrors(e => ({ ...e, [field]: validateMember({ ...newMember })[field] }));
  }

  function changeMemberField(field: MemberField, value: string) {
    const updated = { ...newMember, [field]: value };
    setNewMember(updated);
    if (memberTouched[field])
      setMemberErrors(e => ({ ...e, [field]: validateMember(updated)[field] }));
  }

  async function handleAddMember() {
    const errs = validateMember(newMember);
    setMemberTouched({ name: true, phone: true, email: true, communityId: true, payment: true, validUntil: true });
    setMemberErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setAddingMember(true);
    try {
      await api.post("/api/v1/admin/members", {
        phone: newMember.phone,
        name: newMember.name,
        email: newMember.email,
        communityId: newMember.communityId,
        payment: parseFloat(newMember.payment),
        validUntil: newMember.validUntil,
      });
      toast.success({ title: "Member added", message: `${newMember.name} can now sign up at /signup` });
      close();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  }

  function openEditModal(m: MemberItem) {
    setSelectedMember(m);
    setEditForm({ name: m.name, phone: m.phone, email: m.email });
    setEditNewCom({ communityId: "", payment: "", paidOn: "", validUntil: "" });
    setShowAddCom(false);
    setEditErrors({});
    setModal("edit");
  }

  function validateEditForm() {
    const errs: Partial<Record<string, string>> = {};
    if (editForm.name.trim().length < 2) errs.name = "Name must be at least 2 characters";
    const digits = editForm.phone.replace(/\D/g, "");
    if (!digits) errs.phone = "Phone is required";
    else if (digits.length !== 10 && !(digits.length === 12 && digits.startsWith("91")))
      errs.phone = "Enter a valid 10-digit phone number";
    if (!editForm.email) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) errs.email = "Invalid email address";
    if (showAddCom) {
      if (!editNewCom.communityId) errs.newCommunityId = "Select a community";
      const amt = parseFloat(editNewCom.payment);
      if (!editNewCom.payment || isNaN(amt) || amt <= 0) errs.newPayment = "Enter a valid payment amount";
      if (!editNewCom.validUntil) errs.newValidUntil = "Valid till date is required";
    }
    return errs;
  }

  async function handleUpdateMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMember) return;
    const errs = validateEditForm();
    setEditErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setEditSubmitting(true);
    try {
      const body: {
        name: string; phone: string; email: string;
        newCommunity?: { communityId: string; payment: number; paidOn?: string; validUntil: string }
      } = { name: editForm.name, phone: editForm.phone, email: editForm.email };
      if (showAddCom && editNewCom.communityId) {
        body.newCommunity = {
          communityId: editNewCom.communityId,
          payment: parseFloat(editNewCom.payment),
          validUntil: editNewCom.validUntil,
          ...(editNewCom.paidOn ? { paidOn: editNewCom.paidOn } : {}),
        };
      }
      const updated = await api.patch<MemberItem>(`/api/v1/admin/members/${selectedMember.id}`, body);
      setMembers(prev => prev.map(m => (m.id === updated.id ? updated : m)));
      toast.success({ title: "Member updated", message: `${updated.name} has been updated.` });
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleRevokeCommunity(m: MemberItem, communityId: string, communityName: string) {
    const ok = await confirm({
      title: "Remove from Community?",
      message: (
        <>
          This will remove <span className="font-semibold text-primary">{m.name}</span> from{" "}
          <span className="font-semibold text-primary">{communityName}</span>.
          {m.allSubscriptions.length <= 1
            ? " Since this is their only community, their account will also be deactivated."
            : ""}
        </>
      ),
      confirmLabel: "Yes, Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setRevokingCommunity(true);
    try {
      await api.delete(`/api/v1/admin/members/${m.id}/communities/${communityId}`);
      toast.success({ title: "Access revoked", message: `${m.name} removed from ${communityName}.` });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke access");
    } finally {
      setRevokingCommunity(false);
    }
  }

  function exportMembersCSV() {
    const header = ["Name", "Phone", "Email", "Community", "Payment", "Paid On", "Valid Till", "Status", "Added On"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = members
      .flatMap(m =>
        m.allSubscriptions.length > 0
          ? m.allSubscriptions.map(sub => ({ m, sub }))
          : [{ m, sub: null as MemberSubscription | null }]
      )
      .map(({ m, sub }) => [
        m.name,
        m.phone,
        m.email,
        sub?.communityName ?? "—",
        sub ? formatCurrency(sub.payment) : "—",
        formatDate(sub?.paidOn),
        formatDate(sub?.validUntil),
        STATUS_LABELS[m.status] ?? m.status,
        formatDate(m.createdAt),
      ]);
    const csv = "﻿" + [header, ...rows].map(r => r.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fieldCls = (err?: string) =>
    `mt-2 w-full rounded-xl border bg-white px-4 py-2.5 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 ${
      err ? "border-red-400 focus:ring-red-200" : "border-divider focus:ring-accent/40"
    }`;

  const dateCls = "rounded-lg border border-divider px-2 py-1.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-accent/40 bg-white";
  const selectCls = "rounded-full border border-divider px-3 py-2 text-xs font-semibold text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 bg-white cursor-pointer";

  const summaryStats = [
    { value: String(statsData.total), label: "Total Members" },
    { value: String(statsData.registered), label: "Registered" },
    { value: String(statsData.pending), label: "Pending Registration" },
  ];

  const pages = getPaginationPages(page, totalPages);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Members</p>
          <h1 className="font-display text-2xl font-bold text-primary">Member Management</h1>
          <p className="mt-1 text-sm text-muted">View and manage all whitelisted members.</p>
        </div>
        <div className="flex items-center gap-3">
          {selectMode ? (
            <>
              <button
                onClick={exitSelectMode}
                className="flex items-center gap-2 rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkDeleting}
                className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={14} />
                Delete Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
              </button>
            </>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-100"
            >
              <Trash2 size={14} />
              Bulk Delete
            </button>
          )}
          <button
            onClick={() => setModal("add")}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
          >
            <Plus size={14} />
            Add Member
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {summaryStats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-white p-5 text-center shadow-card">
            <p className="font-display text-2xl font-bold text-primary">{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-card sm:p-6">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-48 flex-1 items-center gap-2 rounded-full border border-divider px-4 py-2 transition-colors focus-within:border-accent">
            <Search size={15} className="shrink-0 text-subtle" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
            />
          </div>

          <select value={filterCommunity} onChange={e => setFilterCommunity(e.target.value)} className={selectCls}>
            <option value="">All Communities</option>
            {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={selectCls}>
            <option value="">All Status</option>
            <option value="registered">Registered</option>
            <option value="pending">Pending Sign</option>
            <option value="expired">Expired</option>
            <option value="suspended">Suspended</option>
          </select>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">Valid Till</span>
            <input type="date" value={validDate} onChange={e => setValidDate(e.target.value)} className={dateCls} />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">Paid On</span>
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} className={dateCls} />
          </div>

          <button
            onClick={exportMembersCSV}
            disabled={members.length === 0}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mt-8 flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-divider border-t-accent" />
          </div>
        )}

        {/* Empty state */}
        {!loading && members.length === 0 && (
          <div className="mt-8 flex flex-col items-center justify-center py-12 text-center">
            <p className="font-semibold text-primary">No members found</p>
            <p className="mt-1 text-sm text-muted">Try adjusting your filters or add a new member.</p>
          </div>
        )}

        {/* Mobile card list */}
        {!loading && members.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 lg:hidden">
            {members.flatMap(m =>
              m.allSubscriptions.length > 0
                ? m.allSubscriptions.map(sub => ({ m, sub }))
                : [{ m, sub: null as MemberSubscription | null }]
            ).map(({ m, sub }) => (
              <div key={`${m.id}-${sub?.id ?? "none"}`} className="rounded-xl border border-divider p-4 transition-shadow hover:shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-divider text-accent focus:ring-accent/40"
                        aria-label={`Select ${m.name}`}
                      />
                    )}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                      {getInitials(m.name)}
                    </div>
                    <div>
                      <p className="font-semibold text-primary">{m.name}</p>
                      <p className="text-xs text-subtle">{m.phone}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[m.status] ?? ""}`}>
                    {STATUS_LABELS[m.status] ?? m.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-subtle">Payment</p><p className="font-semibold text-primary">{sub ? formatCurrency(sub.payment) : "—"}</p></div>
                  <div><p className="text-xs text-subtle">Valid Till</p><p className="font-semibold text-primary">{formatDate(sub?.validUntil)}</p></div>
                  <div>
                    <p className="text-xs text-subtle">Community</p>
                    {sub
                      ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${communityBadge(sub.communityName)}`}>{sub.communityName}</span>
                      : <span className="text-xs text-muted">—</span>}
                  </div>
                  <div><p className="text-xs text-subtle">Added</p><p className="text-primary">{formatDate(m.createdAt)}</p></div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-divider pt-3">
                  <button onClick={() => openExtendModal({ ...m, subscription: sub })} disabled={!sub} className="flex items-center gap-1 rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40">
                    <Plus size={10} /> Extend
                  </button>
                  <button onClick={() => openEditModal(m)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent" title="Edit member"><Pencil size={13} /></button>
                  <button onClick={() => (m.status === "suspended" ? handleRevokeSuspension(m) : openSuspendModal(m))} disabled={revoking} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-amber-50 hover:text-amber-500"><Ban size={13} /></button>
                  <button
                    onClick={() => sub ? handleRevokeCommunity(m, sub.communityId, sub.communityName) : handleDeleteMember(m)}
                    disabled={deleting || revokingCommunity}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500"
                    title={sub ? `Remove from ${sub.communityName}` : "Deactivate member"}
                  ><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Desktop table */}
        {!loading && members.length > 0 && (
          <div className="mt-4 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-225 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase text-subtle">
                  {selectMode && (
                    <th className="py-3 pl-2 pr-3">
                      <input
                        type="checkbox"
                        checked={allSelectedOnPage}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 cursor-pointer rounded border-divider text-accent focus:ring-accent/40"
                        aria-label="Select all on this page"
                      />
                    </th>
                  )}
                  <th className="py-3 pl-2 pr-3">#</th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Payment</th>
                  <th className="px-3 py-3">Paid On</th>
                  <th className="px-3 py-3">Valid Till</th>
                  <th className="px-3 py-3">Added</th>
                  <th className="px-3 py-3">Community</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.flatMap((m, mi) =>
                  m.allSubscriptions.length > 0
                    ? m.allSubscriptions.map((sub, si) => ({ m, sub, rowIdx: mi * 10 + si }))
                    : [{ m, sub: null as MemberSubscription | null, rowIdx: mi * 10 }]
                ).map(({ m, sub, rowIdx }) => (
                  <tr key={`${m.id}-${sub?.id ?? "none"}`} className="border-t border-divider transition-colors hover:bg-background">
                    {selectMode && (
                      <td className="py-3 pl-2 pr-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(m.id)}
                          onChange={() => toggleSelect(m.id)}
                          className="h-4 w-4 cursor-pointer rounded border-divider text-accent focus:ring-accent/40"
                          aria-label={`Select ${m.name}`}
                        />
                      </td>
                    )}
                    <td className="py-3 pl-2 pr-3 text-xs text-subtle">{(page - 1) * 8 + rowIdx + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                          {getInitials(m.name)}
                        </div>
                        <span className="font-semibold text-primary">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{m.phone}</td>
                    <td className="px-3 py-3 font-semibold text-primary">{sub ? formatCurrency(sub.payment) : "—"}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(sub?.paidOn)}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(sub?.validUntil)}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(m.createdAt)}</td>
                    <td className="px-3 py-3">
                      {sub
                        ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${communityBadge(sub.communityName)}`}>{sub.communityName}</span>
                        : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td className="px-3 py-3 text-muted">{m.email}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[m.status] ?? ""}`}>
                        {STATUS_LABELS[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openExtendModal({ ...m, subscription: sub })} disabled={!sub} className="flex items-center gap-1 rounded-full border border-accent px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40">
                          <Plus size={10} /> Extend
                        </button>
                        <button onClick={() => openEditModal(m)} title="Edit member" className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => (m.status === "suspended" ? handleRevokeSuspension(m) : openSuspendModal(m))} disabled={revoking} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-amber-50 hover:text-amber-500">
                          <Ban size={13} />
                        </button>
                        <button
                          onClick={() => sub ? handleRevokeCommunity(m, sub.communityId, sub.communityName) : handleDeleteMember(m)}
                    disabled={deleting || revokingCommunity}
                          title={sub ? `Remove from ${sub.communityName}` : "Deactivate member"}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-subtle">Showing {members.length} of {total} members</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              {pages.map((n, idx) =>
                n === null ? (
                  <span key={`e-${idx}`} className="text-sm text-subtle">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`h-8 w-8 rounded-full text-sm font-semibold transition-colors ${n === page ? "bg-primary text-white shadow-glow" : "text-muted hover:bg-divider/60"}`}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Member Modal */}
      {modal === "add" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Add Member</h3>
              <button onClick={close} className="rounded-full p-1 text-subtle transition-colors hover:bg-divider/60 hover:text-primary"><X size={18} /></button>
            </div>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Name</label>
                <input type="text" placeholder="Enter name" value={newMember.name}
                  onChange={e => changeMemberField("name", e.target.value)}
                  onBlur={() => blurMemberField("name")}
                  className={fieldCls(memberErrors.name)} />
                {memberErrors.name && <p className="mt-1 text-xs text-red-500">{memberErrors.name}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Phone Number</label>
                <input type="tel" placeholder="10-digit number" value={newMember.phone}
                  onChange={e => changeMemberField("phone", e.target.value)}
                  onBlur={() => blurMemberField("phone")}
                  className={fieldCls(memberErrors.phone)} />
                {memberErrors.phone && <p className="mt-1 text-xs text-red-500">{memberErrors.phone}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Email</label>
                <input type="email" placeholder="Enter email" value={newMember.email}
                  onChange={e => changeMemberField("email", e.target.value)}
                  onBlur={() => blurMemberField("email")}
                  className={fieldCls(memberErrors.email)} />
                {memberErrors.email && <p className="mt-1 text-xs text-red-500">{memberErrors.email}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Community</label>
                <select value={newMember.communityId}
                  onChange={e => changeMemberField("communityId", e.target.value)}
                  onBlur={() => blurMemberField("communityId")}
                  className={fieldCls(memberErrors.communityId)}>
                  <option value="">Select community</option>
                  {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {memberErrors.communityId && <p className="mt-1 text-xs text-red-500">{memberErrors.communityId}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-primary">Payment (₹)</label>
                  <input type="number" placeholder="4000" value={newMember.payment}
                    onChange={e => changeMemberField("payment", e.target.value)}
                    onBlur={() => blurMemberField("payment")}
                    className={fieldCls(memberErrors.payment)} />
                  {memberErrors.payment && <p className="mt-1 text-xs text-red-500">{memberErrors.payment}</p>}
                </div>
                <div>
                  <label className="text-sm font-semibold text-primary">Valid Till</label>
                  <input type="date" value={newMember.validUntil}
                    onChange={e => changeMemberField("validUntil", e.target.value)}
                    onBlur={() => blurMemberField("validUntil")}
                    className={fieldCls(memberErrors.validUntil)} />
                  {memberErrors.validUntil && <p className="mt-1 text-xs text-red-500">{memberErrors.validUntil}</p>}
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-subtle">
              The member will be whitelisted. They can then sign up at <span className="font-semibold text-accent">/signup</span> and set their own password.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button onClick={close} disabled={addingMember}
                className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleAddMember} disabled={addingMember}
                className="flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
                {addingMember ? "Adding…" : "Add Member"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Subscription Modal */}
      {modal === "extend" && selectedMember?.subscription && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Extend Subscription</h3>
              <button onClick={close} className="rounded-full p-1 text-subtle transition-colors hover:bg-divider/60 hover:text-primary"><X size={18} /></button>
            </div>
            <p className="mt-1 text-sm text-muted">
              {selectedMember.name} &middot; {selectedMember.subscription.communityName} &middot; currently valid till {formatDate(selectedMember.subscription.validUntil)}
            </p>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Current Date</label>
                <input type="text" value={new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} disabled
                  className="mt-2 w-full rounded-xl border border-divider bg-divider/40 px-4 py-3 text-sm text-muted" />
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Payment (₹)</label>
                <input type="number" placeholder="4000" value={extendPayment}
                  onChange={(e) => setExtendPayment(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
                {extendErrors.payment && <p className="mt-1 text-xs text-red-500">{extendErrors.payment}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Extend Date</label>
                <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
                {extendErrors.extendDate && <p className="mt-1 text-xs text-red-500">{extendErrors.extendDate}</p>}
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={close} disabled={extending}
                className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleExtendSubscription} disabled={extending}
                className="flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
                {extending ? "Extending…" : "Extend Subscription"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Modal */}
      {modal === "suspend" && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-500"><Ban size={18} /></div>
              <h3 className="font-display text-lg font-bold text-primary">Add Reason for Suspension</h3>
            </div>
            <p className="mt-2 text-sm text-muted">Suspending {selectedMember.name} will block them from signing in until revoked. Please provide a reason.</p>
            <textarea rows={4} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Enter reason..."
              className="mt-4 w-full resize-none rounded-xl border border-divider bg-white px-4 py-3 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
            <div className="mt-4 flex items-center gap-3">
              <button onClick={close} disabled={suspending}
                className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSuspendMember} disabled={suspending}
                className="flex-1 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
                {suspending ? "Suspending…" : "Suspend"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {modal === "edit" && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-md rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Edit Member</h3>
              <button onClick={close} className="rounded-full p-1 text-subtle transition-colors hover:bg-divider/60 hover:text-primary"><X size={18} /></button>
            </div>
            <form onSubmit={handleUpdateMember} className="mt-5 flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Name</label>
                <input type="text" value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className={fieldCls(editErrors.name)} placeholder="Full name" />
                {editErrors.name && <p className="mt-1 text-xs text-red-500">{editErrors.name}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Phone Number</label>
                <input type="tel" value={editForm.phone}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  className={fieldCls(editErrors.phone)} placeholder="10-digit number" />
                {editErrors.phone && <p className="mt-1 text-xs text-red-500">{editErrors.phone}</p>}
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Email</label>
                <input type="email" value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className={fieldCls(editErrors.email)} placeholder="Enter email" />
                {editErrors.email && <p className="mt-1 text-xs text-red-500">{editErrors.email}</p>}
              </div>

              {/* Current communities */}
              {selectedMember.allSubscriptions.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-primary">Current Communities</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {selectedMember.allSubscriptions.map(s => (
                      <span key={s.id} className={`rounded-full px-3 py-1 text-xs font-bold ${communityBadge(s.communityName)}`}>{s.communityName}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Add to another community */}
              {!showAddCom ? (
                <button type="button" onClick={() => setShowAddCom(true)}
                  className="flex items-center gap-1.5 self-start text-xs font-semibold text-accent transition-colors hover:text-primary">
                  <Plus size={13} /> Add to another community
                </button>
              ) : (
                <div className="rounded-xl border border-divider p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-primary">Add to Community</p>
                    <button type="button" onClick={() => { setShowAddCom(false); setEditNewCom({ communityId: "", payment: "", paidOn: "", validUntil: "" }); setEditErrors(e => ({ ...e, newCommunityId: undefined, newPayment: undefined, newValidUntil: undefined })); }}
                      className="rounded-full p-0.5 text-subtle hover:text-primary"><X size={14} /></button>
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    <div>
                      <label className="text-xs font-semibold text-muted">Community</label>
                      <select value={editNewCom.communityId}
                        onChange={e => setEditNewCom(c => ({ ...c, communityId: e.target.value }))}
                        className={fieldCls(editErrors.newCommunityId)}>
                        <option value="">Select community</option>
                        {communities
                          .filter(c => !selectedMember.allSubscriptions.some(s => s.communityId === c.id))
                          .map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                        }
                      </select>
                      {editErrors.newCommunityId && <p className="mt-1 text-xs text-red-500">{editErrors.newCommunityId}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-muted">Payment (₹)</label>
                        <input type="number" placeholder="4000" value={editNewCom.payment}
                          onChange={e => setEditNewCom(c => ({ ...c, payment: e.target.value }))}
                          className={fieldCls(editErrors.newPayment)} />
                        {editErrors.newPayment && <p className="mt-1 text-xs text-red-500">{editErrors.newPayment}</p>}
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted">Valid Till</label>
                        <input type="date" value={editNewCom.validUntil}
                          onChange={e => setEditNewCom(c => ({ ...c, validUntil: e.target.value }))}
                          className={fieldCls(editErrors.newValidUntil)} />
                        {editErrors.newValidUntil && <p className="mt-1 text-xs text-red-500">{editErrors.newValidUntil}</p>}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted">Paid On (optional)</label>
                      <input type="date" value={editNewCom.paidOn}
                        onChange={e => setEditNewCom(c => ({ ...c, paidOn: e.target.value }))}
                        className={fieldCls()} />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button type="button" onClick={close} disabled={editSubmitting}
                  className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={editSubmitting}
                  className="flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
                  {editSubmitting ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
