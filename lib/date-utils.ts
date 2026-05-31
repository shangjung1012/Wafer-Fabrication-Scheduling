export function toUtcDateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function isBeforeDateOnly(a: Date, b: Date): boolean {
  return toUtcDateOnly(a).getTime() < toUtcDateOnly(b).getTime();
}
