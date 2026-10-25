import { addDays, addMonths, endOfMonth, startOfToday } from "@/lib/dates";
import type { DatePreset } from "@/components/ui/DatePicker";

/** "+1 month", "+3 months" … counted from `from` — for setting how long a subscription now runs. */
export function durationPresets(from: Date = startOfToday()): DatePreset[] {
  return [
    { label: "+1 month", date: addMonths(from, 1) },
    { label: "+3 months", date: addMonths(from, 3) },
    { label: "+6 months", date: addMonths(from, 6) },
    { label: "+1 year", date: addMonths(from, 12) },
  ];
}

/** Shortcuts for the "Valid till" list filter. */
export function validTillFilterPresets(): DatePreset[] {
  const today = startOfToday();
  return [
    { label: "Today", date: today },
    { label: "In 7 days", date: addDays(today, 7) },
    { label: "In 30 days", date: addDays(today, 30) },
    { label: "End of month", date: endOfMonth(today) },
  ];
}

/** Shortcuts for the "Paid on" list filter and any paid-on field. */
export function paidOnPresets(): DatePreset[] {
  const today = startOfToday();
  return [
    { label: "Today", date: today },
    { label: "Yesterday", date: addDays(today, -1) },
    { label: "7 days ago", date: addDays(today, -7) },
  ];
}
