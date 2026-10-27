/**
 * UoM room bookings show up in timetable feeds as "Event type: Booking_Accepted".
 * Cancelled ones don't count, so whoever cancelled can book again that day.
 */
export function isBooking(event) {
  return /^booking/i.test(event.kind) && !/reject|cancel|declin|withdr/i.test(`${event.kind} ${event.status}`);
}
