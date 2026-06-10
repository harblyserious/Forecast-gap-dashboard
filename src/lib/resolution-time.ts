// Daily-high markets cover the calendar day midnight–midnight in the city's
// local timezone, so the market's effective resolution moment is end-of-day
// midnight local time on the resolution date. The UTC offset depends on both
// the date (DST) and the city — derive it from the timezone database.

function tzOffsetHours(dateIso: string, timeZone: string): number {
  const noonUtc = new Date(`${dateIso}T12:00:00Z`);
  const localHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone,
    }).format(noonUtc),
    10
  );
  return 12 - localHour; // e.g. 4 for EDT, 7 for PDT
}

/** UTC instant of end-of-day midnight local time for a resolution date (YYYY-MM-DD). */
export function resolutionTimeUtc(resolutionDate: string, timeZone: string): Date {
  const offset = tzOffsetHours(resolutionDate, timeZone);
  const startOfDayUtc = new Date(`${resolutionDate}T00:00:00Z`);
  return new Date(startOfDayUtc.getTime() + (24 + offset) * 3600 * 1000);
}

/** Hours remaining until resolution at a given fetch time. */
export function hoursToResolution(
  resolutionDate: string,
  fetchedAt: string,
  timeZone: string
): number {
  return (
    (resolutionTimeUtc(resolutionDate, timeZone).getTime() - new Date(fetchedAt).getTime()) /
    3600000
  );
}
