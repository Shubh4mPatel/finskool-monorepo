"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import PhoneInput from "@/components/ui/PhoneInput";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";
import { communityOptions, type MemberCommunity } from "./communities";
import { durationPresets } from "./datePresets";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "./memberUi";

const EMPTY_MEMBER = { name: "", phone: "", email: "", communityId: "", payment: "", validUntil: "" };
type MemberForm = typeof EMPTY_MEMBER;
type MemberField = keyof MemberForm;
type MemberErrors = Partial<Record<MemberField, string>>;

function validateMember(m: MemberForm): MemberErrors {
  const e: MemberErrors = {};
  if (m.name.trim().length < 2) e.name = "Name must be at least 2 characters";
  if (!m.phone) e.phone = "Phone is required";
  else if (!isValidPhoneNumber(m.phone)) e.phone = "Enter a valid phone number";
  if (m.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) e.email = "Invalid email address";
  if (!m.communityId) e.communityId = "Select a community";
  const amt = parseFloat(m.payment);
  if (!m.payment || isNaN(amt) || amt <= 0) e.payment = "Enter a valid payment amount";
  if (!m.validUntil) e.validUntil = "Valid till date is required";
  return e;
}

export default function AddMemberModal({
  communities,
  onClose,
  onDone,
}: {
  communities: MemberCommunity[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [member, setMember] = useState(EMPTY_MEMBER);
  const [errors, setErrors] = useState<MemberErrors>({});
  const [touched, setTouched] = useState<Partial<Record<MemberField, boolean>>>({});
  const [adding, setAdding] = useState(false);

  function blurField(field: MemberField) {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors((e) => ({ ...e, [field]: validateMember({ ...member })[field] }));
  }

  function changeField(field: MemberField, value: string) {
    const updated = { ...member, [field]: value };
    setMember(updated);
    if (touched[field]) setErrors((e) => ({ ...e, [field]: validateMember(updated)[field] }));
  }

  function payload() {
    return {
      phone: member.phone,
      name: member.name,
      email: member.email,
      communityId: member.communityId,
      payment: parseFloat(member.payment),
      validUntil: member.validUntil,
    };
  }

  async function handleAdd() {
    const errs = validateMember(member);
    setTouched({ name: true, phone: true, email: true, communityId: true, payment: true, validUntil: true });
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setAdding(true);
    try {
      await api.post("/api/v1/admin/members", payload());
      toast.success({ title: "Member added", message: `${member.name} can now sign up at /signup` });
      onDone();
      onClose();
    } catch (err) {
      // This phone belongs to a suspended/deleted member — addMember stops short of
      // reviving them on its own; confirm with the admin first, then resubmit to the
      // dedicated revive endpoint.
      if (err instanceof ApiError && err.code === "MEMBER_REVIVE_REQUIRED") {
        await handleRevive(err.message);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Failed to add member");
    } finally {
      setAdding(false);
    }
  }

  async function handleRevive(message: string) {
    const ok = await confirm({
      title: "Reactivate Member?",
      message,
      confirmLabel: "Yes, Reactivate",
      variant: "positive",
    });
    if (!ok) return;

    setAdding(true);
    try {
      await api.post("/api/v1/admin/members/revive", payload());
      toast.success({ title: "Member reactivated", message: `${member.name} can now sign up at /signup` });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revive member");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal
      title="Add Member"
      subtitle="Whitelist someone so they can sign up."
      icon={<UserPlus size={18} />}
      onClose={onClose}
      busy={adding}
      footer={
        <>
          <button onClick={onClose} disabled={adding} className={secondaryBtn}>Cancel</button>
          <button onClick={handleAdd} disabled={adding} className={primaryBtn}>{adding ? "Adding…" : "Add Member"}</button>
        </>
      }
    >
      <FormField label="Name" error={errors.name}>
        <input type="text" placeholder="Enter name" value={member.name} autoFocus
          onChange={(e) => changeField("name", e.target.value)} onBlur={() => blurField("name")}
          className={inputCls(errors.name)} />
      </FormField>
      <FormField label="Phone Number" error={errors.phone}>
        <PhoneInput value={member.phone} onChange={(v) => changeField("phone", v)} onBlur={() => blurField("phone")} hasError={!!errors.phone} />
      </FormField>
      <FormField label="Email (optional)" error={errors.email}>
        <input type="email" placeholder="Enter email" value={member.email}
          onChange={(e) => changeField("email", e.target.value)} onBlur={() => blurField("email")}
          className={inputCls(errors.email)} />
      </FormField>
      <FormField label="Community" error={errors.communityId}>
        <Select
          value={member.communityId}
          placeholder="Select community"
          ariaLabel="Community"
          className="w-full"
          triggerClassName={`relative text-left ${inputCls(errors.communityId)}`}
          options={communityOptions(communities)}
          onChange={(v) => {
            setMember((m) => ({ ...m, communityId: v }));
            setTouched((t) => ({ ...t, communityId: true }));
            setErrors((e) => ({ ...e, communityId: v ? undefined : "Select a community" }));
          }}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Payment (₹)" error={errors.payment}>
          <input type="number" placeholder="4000" value={member.payment}
            onChange={(e) => changeField("payment", e.target.value)} onBlur={() => blurField("payment")}
            className={inputCls(errors.payment)} />
        </FormField>
        <FormField label="Valid Till" error={errors.validUntil}>
          <DatePicker
            value={member.validUntil}
            ariaLabel="Valid till"
            presets={durationPresets()}
            triggerClassName={inputCls(errors.validUntil)}
            onChange={(v) => {
              setMember((m) => ({ ...m, validUntil: v }));
              setTouched((t) => ({ ...t, validUntil: true }));
              setErrors((e) => ({ ...e, validUntil: v ? undefined : "Valid till date is required" }));
            }}
          />
        </FormField>
      </div>
      <p className="rounded-xl bg-background px-3.5 py-2.5 text-xs text-muted">
        The member will be whitelisted. They can then sign up at <span className="font-semibold text-accent">/signup</span> and set their own password.
      </p>
    </Modal>
  );
}
