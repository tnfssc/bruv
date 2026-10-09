/** Fail at the missing value, not at a later property access. */
export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected a value");
  return value;
}
