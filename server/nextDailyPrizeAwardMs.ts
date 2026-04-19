/**
 * Next scheduled daily prize run: 4:00 PM local time in America/New_York (matches `dailyPrizeScheduler`).
 */
export function nextDailyPrizeAwardMs(from: Date = new Date()): number {
  const tz = "America/New_York";
  let t = Math.floor(from.getTime() / 60_000) * 60_000;
  if (t <= from.getTime()) t += 60_000;
  const limit = from.getTime() + 10 * 24 * 60 * 60 * 1000;
  while (t < limit) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(t));
    const h = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    if (h === 16 && m === 0) return t;
    t += 60_000;
  }
  return from.getTime() + 24 * 60 * 60 * 1000;
}
