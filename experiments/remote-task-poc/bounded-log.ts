// Reserve one of 160 slots for a durable terminal outcome.
export function eventDecision(count: number, envelopeBytes: number): string | null {
  if (count >= 159) return "event count cap (159 data events)";
  if (envelopeBytes > 20000) return "event JSON byte cap (20000)";
  return null;
}
