"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import type { MemberItem } from "@/lib/memberFormat";
import { inputCls, secondaryBtn } from "./memberUi";

export default function SuspendModal({
  member,
  onClose,
  onDone,
}: {
  member: MemberItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [suspending, setSuspending] = useState(false);

  async function handleSuspend() {
    if (!reason.trim()) {
      toast.error("Please provide a reason for suspension");
      return;
    }
    setSuspending(true);
    try {
      await api.patch(`/api/v1/admin/members/${member.id}/suspend`, { reason: reason.trim() });
      toast.success({ title: "Member suspended", message: `${member.name} can no longer sign in.` });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to suspend member");
    } finally {
      setSuspending(false);
    }
  }

  return (
    <Modal
      title="Suspend Member"
      subtitle={member.name}
      icon={<Ban size={18} />}
      iconClass="bg-amber-100 text-amber-600"
      size="sm"
      onClose={onClose}
      busy={suspending}
      footer={
        <>
          <button onClick={onClose} disabled={suspending} className={secondaryBtn}>Cancel</button>
          <button
            onClick={handleSuspend}
            disabled={suspending}
            className="flex-1 rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {suspending ? "Suspending…" : "Suspend"}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Suspending {member.name} will block them from signing in until the suspension is revoked. Please give a reason — they&apos;ll see it.
      </p>
      <textarea
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Enter reason…"
        autoFocus
        className={`${inputCls()} resize-none`}
      />
    </Modal>
  );
}
