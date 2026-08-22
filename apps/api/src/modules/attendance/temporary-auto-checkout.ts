/**
 * Temporary auto-checkout mode — easy to enable/disable without rewriting
 * missing-checkout discipline logic.
 *
 * CapRover / .env:
 *   TEMPORARY_AUTO_CHECKOUT=true   → auto punch checkOut after grace; no
 *                                    missing-checkout letters/fines/events
 *   TEMPORARY_AUTO_CHECKOUT=false  → (or unset) restore normal behavior:
 *                                    ShiftMissingCheckoutScheduler applies
 *                                    Advice/Warning/Fine and only sets
 *                                    sessionClosedAt (no auto checkOut)
 *
 * Rollback: set false / remove the var and redeploy. The normal discipline
 * path in applyMissingCheckoutDiscipline and the scheduler stays intact.
 */
export function isTemporaryAutoCheckoutEnabled(): boolean {
  const raw = process.env.TEMPORARY_AUTO_CHECKOUT?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Note stamped on rows closed by the temporary auto-checkout path. */
export const TEMPORARY_AUTO_CHECKOUT_NOTE =
  'Temporary auto-checkout at duty end (discipline suspended)';
