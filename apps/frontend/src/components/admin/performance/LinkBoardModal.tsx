"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { KIND_LABEL, KIND_ORDER, performanceApi, type BoardList, type PerformanceKind } from "@/lib/performance";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "@/components/admin/members/memberUi";

/** Super admin: attach a Performance board of one kind to a community. */
export default function LinkBoardModal({
  unlinked,
  initialKind,
  onClose,
  onDone,
}: {
  unlinked: BoardList["unlinked"];
  initialKind: PerformanceKind;
  onClose: () => void;
  onDone: (kind: PerformanceKind) => void;
}) {
  const toast = useToast();
  const [communityId, setCommunityId] = useState(unlinked[0]?.communityId ?? "");
  const [kind, setKind] = useState<PerformanceKind>(initialKind);
  const [busy, setBusy] = useState(false);

  async function link() {
    if (!communityId) return;
    setBusy(true);
    try {
      await performanceApi.linkBoard(communityId, kind);
      toast.success({ title: "Community linked", message: `${unlinked.find(c => c.communityId === communityId)?.name} now has a ${KIND_LABEL[kind]} board.` });
      onDone(kind);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not link the community");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Link a community"
      subtitle="Choose the community this board belongs to"
      icon={<Link2 size={18} />}
      size="sm"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => void link()} disabled={busy || !communityId} className={primaryBtn}>
            {busy ? "Linking…" : "Link"}
          </button>
        </>
      }
    >
      {unlinked.length === 0 ? (
        <p className="text-sm text-muted">Every paid community already has a Performance board. Create a community first.</p>
      ) : (
        <>
          <FormField label="Board">
            <Select
              value={kind}
              onChange={v => setKind(v as PerformanceKind)}
              options={KIND_ORDER.map(k => ({ value: k, label: KIND_LABEL[k] }))}
              ariaLabel="Board"
              portal
              searchable={false}
              disabled={busy}
              className="w-full"
              triggerClassName={`${inputCls()} relative flex items-center text-left disabled:cursor-not-allowed disabled:opacity-60`}
            />
          </FormField>
          <FormField label="Community">
            <Select
              value={communityId}
              onChange={setCommunityId}
              options={unlinked.map(c => ({ value: c.communityId, label: c.name, ...(c.type ? { hint: c.type } : {}) }))}
              ariaLabel="Community"
              portal
              disabled={busy}
              className="w-full"
              triggerClassName={`${inputCls()} relative flex items-center text-left disabled:cursor-not-allowed disabled:opacity-60`}
            />
          </FormField>
          <p className="text-xs text-muted">The free community cannot have a board. Each community has at most one.</p>
        </>
      )}
    </Modal>
  );
}
