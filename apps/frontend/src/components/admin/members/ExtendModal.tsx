"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import { formatDate, type MemberItem, type MemberSubscription } from "@/lib/memberFormat";
import { FormField, inputCls, primaryBtn, secondaryBtn } from "./memberUi";

type Errors = { payment?: string; extendDate?: string };

function validate(payment: string, validUntil: string): Errors {
  const errs: Errors = {};
  const amt = parseFloat(payment);
  if (!payment || isNaN(amt) || amt <= 0) errs.payment = "Enter a valid payment amount";
  if (!validUntil) errs.extendDate = "Extend date is required";
  else if (new Date(validUntil) <= new Date()) errs.extendDate = "Extend date must be in the future";
  return errs;
}

export default function ExtendModal({
  member,
  subscription,
  onClose,
  onDone,
}: {
  member: MemberItem;
  subscription: MemberSubscription;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [payment, setPayment] = useState(String(subscription.payment));
  const [errors, setErrors] = useState<Errors>({});
  const [extending, setExtending] = useState(false);

  async function handleExtend() {
    const errs = validate(payment, date);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setExtending(true);
    try {
      await api.post(`/api/v1/admin/subscriptions/${subscription.id}/extend`, {
        validUntil: date,
        payment: parseFloat(payment),
      });
      toast.success({
        title: "Subscription extended",
        message: `${member.name}'s subscription is now valid until ${formatDate(date)}`,
      });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to extend subscription");
    } finally {
      setExtending(false);
    }
  }

  return (
    <Modal
      title="Extend Subscription"
      subtitle={`${member.name} · ${subscription.communityName} · valid till ${formatDate(subscription.validUntil)}`}
      icon={<CalendarClock size={18} />}
      size="sm"
      onClose={onClose}
      busy={extending}
      footer={
        <>
          <button onClick={onClose} disabled={extending} className={secondaryBtn}>Cancel</button>
          <button onClick={handleExtend} disabled={extending} className={primaryBtn}>{extending ? "Extending…" : "Extend"}</button>
        </>
      }
    >
      <FormField label="Current Date">
        <input
          type="text"
          disabled
          value={new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          className="w-full rounded-xl border border-divider bg-divider/40 px-4 py-2.5 text-sm text-muted"
        />
      </FormField>
      <FormField label="Payment (₹)" error={errors.payment}>
        <input type="number" placeholder="4000" value={payment} onChange={(e) => setPayment(e.target.value)} className={inputCls(errors.payment)} />
      </FormField>
      <FormField label="Extend Date" error={errors.extendDate}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls(errors.extendDate)} autoFocus />
      </FormField>
    </Modal>
  );
}
