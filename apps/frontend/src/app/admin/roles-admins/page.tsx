"use client";

import { useState } from "react";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";

const admins = [
  { id: 1, name: "Hardik", initials: "H", email: "hardik@gmail.com", access: "Both Communities", accessColor: "bg-primary text-white", lastActive: "Just now", isSuperAdmin: true },
  { id: 2, name: "Rahul Sen", initials: "RS", email: "rahul@outlook.com", access: "Swing Alpha", accessColor: "bg-lime/40 text-primary", lastActive: "2 hours ago", isSuperAdmin: false },
  { id: 3, name: "Priya Rao", initials: "PR", email: "priya@gmail.com", access: "Investor", accessColor: "bg-accent/10 text-accent", lastActive: "Yesterday", isSuperAdmin: false },
  { id: 4, name: "Amit Sharma", initials: "AS", email: "amit@yahoo.com", access: "Swing Alpha", accessColor: "bg-lime/40 text-primary", lastActive: "3 days ago", isSuperAdmin: false },
  { id: 5, name: "Sneha Sharma", initials: "SS", email: "sneha@gmail.com", access: "Both Communities", accessColor: "bg-primary text-white", lastActive: "1 week ago", isSuperAdmin: false },
];

export default function RolesAdminsPage() {
  const [deleteModal, setDeleteModal] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Admin Panel</p>
          <h1 className="font-display text-2xl font-bold text-primary">Team & Role Management</h1>
          <p className="mt-1 text-sm text-muted">Manage admin accounts and their access levels. Super Admin access only.</p>
        </div>
        <button className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-primary px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95">
          <Plus size={14} />
          Add New Admin
        </button>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-divider px-4 py-2 transition-colors focus-within:border-accent">
            <Search size={15} className="shrink-0 text-subtle" />
            <input type="text" placeholder="Search by name or email..." className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none" />
          </div>
          <button className="flex items-center gap-2 rounded-full border border-divider px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary">
            All Communities <ChevronDown size={14} />
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase text-subtle">
                <th className="px-3 py-3">Admin</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Community Access</th>
                <th className="px-3 py-3">Last Active</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-t border-divider transition-colors hover:bg-background">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xs font-bold text-lime">
                        {a.initials}
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
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${a.accessColor}`}>{a.access}</span>
                  </td>
                  <td className="px-3 py-3 text-muted">{a.lastActive}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent">
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteModal(true)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card-hover text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-500">
              <Trash2 size={20} />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-primary">Delete Admin?</h3>
            <p className="mt-2 text-sm text-muted">
              This will remove them admin access immediately. Their admin data will be archived by default.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => setDeleteModal(false)} className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary">
                Cancel
              </button>
              <button onClick={() => setDeleteModal(false)} className="flex-1 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95">
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
