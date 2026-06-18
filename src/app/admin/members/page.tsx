"use client";

import { useState } from "react";
import { Ban, ChevronDown, Download, Pencil, Plus, Search, Trash2, X } from "lucide-react";

const stats = [
  { value: "560", label: "Total Members" },
  { value: "498", label: "Registered" },
  { value: "62", label: "Pending Registration" },
  { value: "14", label: "Expiring This Week", highlight: true },
];

const statusStyles: Record<string, string> = {
  Registered: "bg-accent/10 text-accent",
  "Pending Sign": "bg-amber-100 text-amber-600",
  Expired: "bg-red-100 text-red-500",
};

const members = [
  { id: 1, name: "Sandeep", initials: "S", phone: "9898060907", payment: "₹4,000", paidOn: "15 Aug 2026", valid: "15 Aug 2026", registered: "2 May 2026", community: "Swing Alpha", communityColor: "bg-lime/40 text-primary", email: "ayushman@example.com", status: "Registered" },
  { id: 2, name: "Raj", initials: "R", phone: "9898060907", payment: "₹50,000", paidOn: "20 Jun 2026", valid: "20 Jun 2026", registered: "19 Apr 2026", community: "Investor", communityColor: "bg-accent/10 text-accent", email: "ayushman@example.com", status: "Registered" },
  { id: 3, name: "Priya", initials: "P", phone: "9898069907", payment: "₹50,000", paidOn: "14 Jun 2026", valid: "14 Jun 2026", registered: "1 Mar 2026", community: "Investor", communityColor: "bg-accent/10 text-accent", email: "ayushman@example.com", status: "Pending Sign" },
  { id: 4, name: "Neha Verma", initials: "NV", phone: "9898069907", payment: "₹90,000", paidOn: "10 Jun 2026", valid: "20 Jun 2026", registered: "10 Feb 2026", community: "Investor", communityColor: "bg-accent/10 text-accent", email: "ayushman@example.com", status: "Expired" },
  { id: 5, name: "Deepak Sharma", initials: "DS", phone: "9898069907", payment: "₹70,000", paidOn: "30 Sep 2026", valid: "30 Sep 2026", registered: "20 May 2026", community: "Swing Alpha", communityColor: "bg-lime/40 text-primary", email: "ayushman@example.com", status: "Pending Sign" },
  { id: 6, name: "Jai Sharma", initials: "JS", phone: "9898069907", payment: "₹80,000", paidOn: "1 Dec 2026", valid: "1 Dec 2026", registered: "20 May 2026", community: "Investor", communityColor: "bg-accent/10 text-accent", email: "ayushman@example.com", status: "Registered" },
  { id: 7, name: "Hari Singh", initials: "HS", phone: "9898969907", payment: "₹1,00,000", paidOn: "16 Jun 2026", valid: "16 Jun 2026", registered: "5 Apr 2026", community: "Swing Alpha", communityColor: "bg-lime/40 text-primary", email: "ayushman@example.com", status: "Pending Sign" },
];

type ModalType = "add" | "extend" | "delete" | "suspend" | "revoke" | null;

export default function MembersPage() {
  const [modal, setModal] = useState<ModalType>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [extendDate, setExtendDate] = useState("");
  const [newMember, setNewMember] = useState({ name: "", phone: "", email: "", community: "", payment: "", valid: "" });
  const close = () => setModal(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Members</p>
          <h1 className="font-display text-2xl font-bold text-primary">Member Management</h1>
          <p className="mt-1 text-sm text-muted">View and manage all whitelisted members.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-100">
            <Trash2 size={14} />
            Bulk Delete
          </button>
          <button
            onClick={() => setModal("add")}
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
          >
            <Plus size={14} />
            Add Member
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-2xl p-5 text-center shadow-card ${s.highlight ? "border border-amber-200 bg-amber-50" : "bg-white"}`}>
            <p className={`font-display text-2xl font-bold ${s.highlight ? "text-amber-500" : "text-primary"}`}>{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-divider px-4 py-2 transition-colors focus-within:border-accent">
            <Search size={15} className="shrink-0 text-subtle" />
            <input type="text" placeholder="Search by name, phone or email..." className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none" />
          </div>
          {["All Communities", "Paid On", "Valid Till", "All Status"].map((f) => (
            <button key={f} className="flex items-center gap-1.5 rounded-full border border-divider px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-primary">
              {f} <ChevronDown size={12} />
            </button>
          ))}
          <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white transition-transform hover:scale-105 active:scale-95">
            <Download size={13} />
            Export CSV
          </button>
        </div>

        {/* Mobile card list */}
        <div className="mt-4 flex flex-col gap-3 lg:hidden">
          {members.map((m) => (
            <div key={m.id} className="rounded-xl border border-divider p-4 transition-shadow hover:shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xs font-bold text-lime">
                    {m.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-primary">{m.name}</p>
                    <p className="text-xs text-subtle">{m.phone}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[m.status] ?? ""}`}>{m.status}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-xs text-subtle">Payment</p><p className="font-semibold text-primary">{m.payment}</p></div>
                <div><p className="text-xs text-subtle">Valid Till</p><p className="font-semibold text-primary">{m.valid}</p></div>
                <div><p className="text-xs text-subtle">Community</p><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${m.communityColor}`}>{m.community}</span></div>
                <div><p className="text-xs text-subtle">Registered</p><p className="text-primary">{m.registered}</p></div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-divider pt-3">
                <button onClick={() => setModal("extend")} className="flex items-center gap-1 rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/5">
                  <Plus size={10} /> Extend
                </button>
                <button onClick={() => setModal(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent"><Pencil size={13} /></button>
                <button onClick={() => setModal(m.status === "Pending Sign" ? "revoke" : "suspend")} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-amber-50 hover:text-amber-500"><Ban size={13} /></button>
                <button onClick={() => setModal("delete")} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="mt-4 hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase text-subtle">
                <th className="py-3 pl-2 pr-3">#</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Phone Number</th>
                <th className="px-3 py-3">Payment</th>
                <th className="px-3 py-3">Paid On</th>
                <th className="px-3 py-3">Valid</th>
                <th className="px-3 py-3">Registered</th>
                <th className="px-3 py-3">Community</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className="border-t border-divider transition-colors hover:bg-background">
                  <td className="py-3 pl-2 pr-3 text-xs text-subtle">{i + 1}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xs font-bold text-lime">
                        {m.initials}
                      </div>
                      <span className="font-semibold text-primary">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">{m.phone}</td>
                  <td className="px-3 py-3 font-semibold text-primary">{m.payment}</td>
                  <td className="px-3 py-3 text-muted">{m.paidOn}</td>
                  <td className="px-3 py-3 text-muted">{m.valid}</td>
                  <td className="px-3 py-3 text-muted">{m.registered}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${m.communityColor}`}>{m.community}</span>
                  </td>
                  <td className="px-3 py-3 text-muted">{m.email}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[m.status] ?? ""}`}>{m.status}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setModal("extend")} className="flex items-center gap-1 rounded-full border border-accent px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/5">
                        <Plus size={10} /> Extend
                      </button>
                      <button onClick={() => setModal(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setModal(m.status === "Pending Sign" ? "revoke" : "suspend")} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-amber-50 hover:text-amber-500">
                        <Ban size={13} />
                      </button>
                      <button onClick={() => setModal("delete")} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-subtle">Showing 7 of 560 members</p>
          <div className="flex items-center gap-2">
            <button className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary">Previous</button>
            <button className="h-8 w-8 rounded-full bg-primary text-sm font-semibold text-white shadow-glow">1</button>
            {[2, 3, 18].map((n) => (
              <button key={n} className="h-8 w-8 rounded-full text-sm font-semibold text-muted transition-colors hover:bg-divider/60">
                {n === 18 ? "..." : n}
              </button>
            ))}
            <button className="rounded-full border border-divider px-4 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary">Next</button>
          </div>
        </div>
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
              {[
                { label: "Name", key: "name", type: "text", placeholder: "Enter name" },
                { label: "Phone Number", key: "phone", type: "tel", placeholder: "Enter Number" },
                { label: "Email", key: "email", type: "email", placeholder: "Enter email" },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="text-sm font-semibold text-primary">{label}</label>
                  <input type={type} placeholder={placeholder} value={newMember[key as keyof typeof newMember]} onChange={(e) => setNewMember((m) => ({ ...m, [key]: e.target.value }))}
                    className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
              ))}
              <div>
                <label className="text-sm font-semibold text-primary">Community</label>
                <select className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40">
                  <option value="">Select Community</option>
                  <option>Swing Alpha</option>
                  <option>Investor Community</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-primary">Payment</label>
                  <input type="number" placeholder="₹ 4000" className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
                <div>
                  <label className="text-sm font-semibold text-primary">Valid Till</label>
                  <input type="date" className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
                </div>
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={close} className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary">Cancel</button>
              <button onClick={close} className="flex-1 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">Add Member</button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Subscription Modal */}
      {modal === "extend" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">Extend Subscription</h3>
              <button onClick={close} className="rounded-full p-1 text-subtle transition-colors hover:bg-divider/60 hover:text-primary"><X size={18} /></button>
            </div>
            <div className="mt-5 flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold text-primary">Current Date</label>
                <input type="text" value="12 Jun 2026" disabled className="mt-2 w-full rounded-xl border border-divider bg-divider/40 px-4 py-3 text-sm text-muted" />
              </div>
              <div>
                <label className="text-sm font-semibold text-primary">Extend Date</label>
                <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-divider bg-white px-4 py-3 text-sm text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={close} className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary">Cancel</button>
              <button onClick={close} className="flex-1 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">Extend Subscription</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {modal === "delete" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-500">
              <Trash2 size={20} />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-primary">Delete User?</h3>
            <p className="mt-2 text-sm text-muted">This action will permanently delete this user. Do you wish to continue?</p>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={close} className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary">Cancel</button>
              <button onClick={close} className="flex-1 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Suspend Modal */}
      {modal === "suspend" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-500"><Ban size={18} /></div>
              <h3 className="font-display text-lg font-bold text-primary">Add Reason for Suspension</h3>
            </div>
            <p className="mt-2 text-sm text-muted">Please provide a reason for suspending this user.</p>
            <textarea rows={4} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Enter reason..."
              className="mt-4 w-full resize-none rounded-xl border border-divider bg-white px-4 py-3 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
            <div className="mt-4 flex items-center gap-3">
              <button onClick={close} className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary">Cancel</button>
              <button onClick={close} className="flex-1 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95">Suspend</button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Suspension Modal */}
      {modal === "revoke" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Ban size={20} />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-primary">Revoke Suspension?</h3>
            <p className="mt-2 text-sm text-muted">This action will revoke the suspension, are you sure you want to continue?</p>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={close} className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary">Cancel</button>
              <button onClick={close} className="flex-1 rounded-full bg-gradient-to-r from-accent to-primary px-5 py-2.5 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">Yes, Revoke</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
