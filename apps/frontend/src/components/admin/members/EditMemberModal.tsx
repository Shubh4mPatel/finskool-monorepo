"use client";

import { useId, useState } from "react";
import { Pencil, Plus, UserCog, X } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import PhoneInput from "@/components/ui/PhoneInput";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";
import { communityBadge, type MemberItem } from "@/lib/memberFormat";
import { communityOptions, type MemberCommunity } from "./communities";
import { durationPresets, paidOnPresets } from "./datePresets";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "./memberUi";

const EMPTY_NEW_COM = { communityId: "", payment: "", paidOn: "", validUntil: "" };

export default function EditMemberModal({
  member,
  communities,
  onClose,
  onUpdated,
}: {
  member: MemberItem;
  communities: MemberCommunity[];
  onClose: () => void;
  onUpdated: (updated: MemberItem) => void;
}) {
  const toast = useToast();
  const formId = useId();
  const [form, setForm] = useState({ name: member.name, phone: member.phone, email: member.email ?? "" });
  const [newCom, setNewCom] = useState(EMPTY_NEW_COM);
  const [showAddCom, setShowAddCom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});

  function validate() {
    const errs: Partial<Record<string, string>> = {};
    if (form.name.trim().length < 2) errs.name = "Name must be at least 2 characters";
    if (!form.phone) errs.phone = "Phone is required";
    else if (!isValidPhoneNumber(form.phone)) errs.phone = "Enter a valid phone number";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email address";
    if (showAddCom) {
      if (!newCom.communityId) errs.newCommunityId = "Select a community";
      const amt = parseFloat(newCom.payment);
      if (!newCom.payment || isNaN(amt) || amt <= 0) errs.newPayment = "Enter a valid payment amount";
      if (!newCom.validUntil) errs.newValidUntil = "Valid till date is required";
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setSubmitting(true);
    try {
      const body: {
        name: string; phone: string; email: string;
        newCommunity?: { communityId: string; payment: number; paidOn?: string; validUntil: string };
      } = { name: form.name, phone: form.phone, email: form.email };
      if (showAddCom && newCom.communityId) {
        body.newCommunity = {
          communityId: newCom.communityId,
          payment: parseFloat(newCom.payment),
          validUntil: newCom.validUntil,
          ...(newCom.paidOn ? { paidOn: newCom.paidOn } : {}),
        };
      }
      const updated = await api.patch<MemberItem>(`/api/v1/admin/members/${member.id}`, body);
      toast.success({ title: "Member updated", message: `${updated.name} has been updated.` });
      onUpdated(updated);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelAddCom() {
    setShowAddCom(false);
    setNewCom(EMPTY_NEW_COM);
    setErrors((e) => ({ ...e, newCommunityId: undefined, newPayment: undefined, newValidUntil: undefined }));
  }

  const available = communities.filter((c) => !member.allSubscriptions.some((s) => s.communityId === c.id));

  return (
    <Modal
      title="Edit Member"
      subtitle={member.name}
      icon={<UserCog size={18} />}
      onClose={onClose}
      busy={submitting}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className={secondaryBtn}>Cancel</button>
          <button type="submit" form={formId} disabled={submitting} className={primaryBtn}>{submitting ? "Saving…" : "Save Changes"}</button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="Name" error={errors.name}>
          <input type="text" value={form.name} placeholder="Full name" autoFocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls(errors.name)} />
        </FormField>
        <FormField label="Phone Number" error={errors.phone}>
          <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} hasError={!!errors.phone} />
        </FormField>
        <FormField label="Email (optional)" error={errors.email}>
          <input type="email" value={form.email} placeholder="Enter email"
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls(errors.email)} />
        </FormField>

        {member.allSubscriptions.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-primary">Current Communities</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {member.allSubscriptions.map((s) => (
                <span key={s.id} className={`rounded-full px-3 py-1 text-xs font-bold ${communityBadge(s.communityName)}`}>{s.communityName}</span>
              ))}
            </div>
          </div>
        )}

        {!showAddCom ? (
          <button type="button" onClick={() => setShowAddCom(true)}
            className="flex items-center gap-1.5 self-start rounded-full border border-dashed border-accent/50 px-3.5 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent/5">
            <Plus size={13} /> Add to another community
          </button>
        ) : (
          <div className="animate-fade rounded-xl border border-divider bg-background/50 p-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold text-primary"><Pencil size={13} className="text-accent" /> Add to Community</p>
              <button type="button" onClick={cancelAddCom} aria-label="Cancel adding a community"
                className="rounded-full p-1 text-subtle transition-colors hover:bg-white hover:text-primary"><X size={14} /></button>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <FormField small label="Community" error={errors.newCommunityId}>
                <Select
                  value={newCom.communityId}
                  placeholder="Select community"
                  ariaLabel="Community to add"
                  className="w-full"
                  triggerClassName={`relative text-left ${inputCls(errors.newCommunityId)}`}
                  options={communityOptions(available)}
                  onChange={(v) => setNewCom((c) => ({ ...c, communityId: v }))}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField small label="Payment (₹)" error={errors.newPayment}>
                  <input type="number" placeholder="4000" value={newCom.payment}
                    onChange={(e) => setNewCom((c) => ({ ...c, payment: e.target.value }))} className={inputCls(errors.newPayment)} />
                </FormField>
                <FormField small label="Valid Till" error={errors.newValidUntil}>
                  <DatePicker
                    value={newCom.validUntil}
                    ariaLabel="Valid till"
                    presets={durationPresets()}
                    triggerClassName={inputCls(errors.newValidUntil)}
                    onChange={(v) => setNewCom((c) => ({ ...c, validUntil: v }))}
                  />
                </FormField>
              </div>
              <FormField small label="Paid On (optional)">
                <DatePicker
                  value={newCom.paidOn}
                  ariaLabel="Paid on"
                  placeholder="Today, if left empty"
                  clearable
                  presets={paidOnPresets()}
                  triggerClassName={inputCls()}
                  onChange={(v) => setNewCom((c) => ({ ...c, paidOn: v }))}
                />
              </FormField>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
