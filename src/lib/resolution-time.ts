// KXHIGHNY markets cover the calendar day midnight–midnight ET. The market's
// effective resolution moment is end-of-day midnight ET on the resolution date.
// ET is UTC-4 (EDT) or UTC-5 (EST) depending on the date — derive the offset
// from the timezone database rather than hardcoding.

function etOffsetHours(dateIso: string): number {
  const noonUtc = new Date(`${dateIso}T12:00:00Z`);
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    }).format(noonUtc),
    10
  );
  return 12 - etHour; // 4 during EDT, 5 during EST
}

/** UTC instant of end-of-day midnight ET for a resolution date (YYYY-MM-DD). */
export function resolutionTimeUtc(resolutionDate: string): Date {
  const offset = etOffsetHours(resolutionDate);
  const startOfDayUtc = new Date(`${resolutionDate}T00:00:00Z`);
  return new Date(startOfDayUtc.getTime() + (24 + offset) * 3600 * 1000);
}

/** Hours remaining until resolution at a given fetch time. */
export function hoursToResolution(resolutionDate: string, fetchedAt: string): number {
  return (resolutionTimeUtc(resolutionDate).getTime() - new Date(fetchedAt).getTime()) / 3600000;
}
