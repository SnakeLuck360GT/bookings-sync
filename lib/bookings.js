/**
 * UoM room bookings show up in timetable feeds as "Event type: Booking_Accepted".
 * Cancelled ones don't count, so whoever cancelled can book again that day.
 */
export function isBooking(event) {
  return /^booking/i.test(event.kind) && !/reject|cancel|declin|withdr/i.test(`${event.kind} ${event.status}`);
}

// Proof opens this long before a booking starts, when the previous one ends.
export const PROOF_EARLY_MINUTES = 10;

export const isConfirmed = (event) => isBooking(event) && /accepted|confirmed/i.test(`${event.kind} ${event.status}`);

/**
 * Feeds served by the university's timetable host (Scientia), as opposed to
 * any calendar link someone could make. Proof is only offered for these.
 */
export function isUniversityFeed(url) {
  if (process.env.ALLOW_LOCAL_FEEDS === "1") return true;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return /^scientia-[a-z0-9-]+\.azurewebsites\.net$/.test(host) || host === "manchester.ac.uk" || host.endsWith(".manchester.ac.uk");
}
