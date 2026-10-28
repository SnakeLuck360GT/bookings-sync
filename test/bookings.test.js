import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, occurrencesBetween } from "../lib/ics.js";
import { isBooking } from "../lib/bookings.js";

const booking = (uid, type, status, extra = "") => `BEGIN:VEVENT
UID:${uid}
DTSTART:20261028T100000Z
DTEND:20261028T120000Z
SUMMARY:Group project
LOCATION:Nancy Rothwell_3A.085 M&T
${extra}DESCRIPTION:Event type: ${type}\\nReference: RB-${uid}\\nStatus: ${status}\\n
END:VEVENT`;

test("only live room bookings count; cancelled ones free up the day", () => {
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${[
    booking("live", "Booking_Accepted", "Accepted"),
    booking("pending", "Booking_Pending", "Pending"),
    booking("cancelled-type", "Booking_Cancelled", "Cancelled"),
    booking("cancelled-status", "Booking_Accepted", "Cancelled"),
    booking("rejected", "Booking_Rejected", "Rejected"),
    booking("ical-cancelled", "Booking_Accepted", "Accepted", "STATUS:CANCELLED\n"),
    `BEGIN:VEVENT
UID:class
DTSTART:20261028T130000Z
DTEND:20261028T140000Z
SUMMARY:COMP23311/LECTURE1/
DESCRIPTION:Event type: LECTURE\\nDescription: Software Engineering 1
END:VEVENT`,
  ].join("\n")}\r\nEND:VCALENDAR\r\n`;

  const kept = occurrencesBetween(parseFeed(ics), new Date("2026-10-28T00:00:00Z"), new Date("2026-10-29T00:00:00Z"))
    .filter(isBooking)
    .map((e) => e.reference);
  assert.deepEqual(kept, ["RB-live", "RB-pending"]);
});

test("only the university's timetable host counts as an official feed", async () => {
  const { isUniversityFeed } = await import("../lib/bookings.js");
  assert.equal(isUniversityFeed("https://scientia-eu-v4-3-api-d3-02.azurewebsites.net//api/ical/a/b/timetable.ics"), true);
  assert.equal(isUniversityFeed("https://my.manchester.ac.uk/Timetable/ical/abc.ics"), true);
  assert.equal(isUniversityFeed("https://example.com/fake.ics"), false);
  assert.equal(isUniversityFeed("https://scientia-eu.azurewebsites.net.evil.com/x.ics"), false);
  assert.equal(isUniversityFeed("https://notmanchester.ac.uk/x.ics"), false);
});

test("only accepted bookings are confirmed", async () => {
  const { isConfirmed } = await import("../lib/bookings.js");
  assert.equal(isConfirmed({ kind: "Booking accepted", status: "Accepted" }), true);
  assert.equal(isConfirmed({ kind: "Booking pending", status: "Pending" }), false);
  assert.equal(isConfirmed({ kind: "Booking accepted", status: "Cancelled" }), false);
  assert.equal(isConfirmed({ kind: "Lecture", status: "" }), false);
});
