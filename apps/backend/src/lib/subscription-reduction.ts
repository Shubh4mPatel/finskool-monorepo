/**
 * Whether a change of end date shortens a plan that is still running. A plan that had already ended, or a new end
 * date that is the same or later, is not a reduction (the first is a renewal, the second an extension).
 *
 * Admins may not shorten a running plan at all (the Extend action and sheet imports refuse it), so this is the check
 * behind that refusal.
 */
export function isReduction(previousEnd: Date | null, newEnd: Date, today: Date): previousEnd is Date {
  return previousEnd !== null && previousEnd >= today && newEnd < previousEnd
}
