# How Bookings works

## The timetable feed

Everyone's My Manchester timetable has an iCal link, served by Scientia (the university's timetabling system). Rooms booked through Resource Booker appear in the same feed as classes. A booking looks like this:

```
SUMMARY:Group Project
LOCATION:Nancy Rothwell_3A.085 M&T
DESCRIPTION:Event type: Booking_Accepted\nLocation: Nancy Rothwell_3A.085 M&T\nReference: RB-28102026120000A1\nStatus: Accepted
```

The server keeps events whose type starts with `Booking` and drops any that are rejected, cancelled, declined or withdrawn. Classes never leave the server. The location is split at the underscore into building (`Nancy Rothwell`) and room (`3A.085 M&T`).

A few things the feed needs handled:

- **Language header.** Scientia returns a 500 error for Node's default `Accept-Language: *`, so requests send `en-GB`.
- **UK time.** Times are converted to UK time whether they come as UTC, with a timezone, or with none, including across the clock change. Feeds that name `GMT Standard Time` or leave out the timezone definition are read as UK time.
- **Caching.** Each feed is kept in memory for 15 minutes. The last good copy is also saved, so if Scientia is down the app shows that instead of nothing. The page fetches a week when you open it and loads the next week in the background.

## Groups and logging in

- A group is one record in Netlify Blobs: a 6-character code and its members. Codes skip 0/O and 1/I/L so they're easy to type.
- Each member has a name, a colour and their timetable link. The link never leaves the server.
- Logging in is your name and the group code. A name already in the group logs you in as that person; a new name is asked for a timetable link. Names are unique within a group, so the name is enough.
- Who you are is remembered per browser. There are no passwords, which keeps it quick but means anyone with the code can pick any name.
- Two people joining at once can't overwrite each other: updates use the record's ETag and retry if it changed.

## A day

- **Status.** The room booked right now and until when, or the next room, or "No room booked yet".
- **Gaps to book.** Stretches between 10:00 (when booking opens) and 18:00 that no booking covers, at least 30 minutes long. The hours and minimum length can be changed in settings.
- **Booking left.** Each person gets one live booking a day. Anyone in the group without one that day is listed. Cancelling removes the booking from the feed, so that person is listed again.
- **Booked rooms.** Each booking in time order with who booked it, the room, building, times and length. The timeline below has a column per room, and longer bookings get bigger room numbers.

### Booking a gap

**Book** links to Resource Booker's room search with the day and times filled in:

```
https://resourcebooker.manchester.ac.uk/app/booking-types/<type>?firstDay=2026-10-29&fromTime=13:15&toTime=16:15
```

- A booking can be made from 24 hours before it starts. Until then the button says when it opens, e.g. "Opens tomorrow 13:15".
- A booking is at most 3 hours, so a longer gap offers its first 3 hours or its last 3 hours.
- If you've already booked that day, there are no Book buttons.
- The link opens in the same tab and is copied first. Resource Booker sometimes loads forever when opened in a new tab on a phone, and pasting the link into a tab works.

### Reminders

Tapping a slot that isn't open yet adds a reminder for the moment it opens. On Android it opens Google Calendar with the event filled in; elsewhere it downloads an `.ics` file. Reminders use UK time, so a weekly one stays at the same time after the clocks change. A one-off reminder links to that slot's booking. A weekly one links to the group, since a single date's link would be wrong the following week.

## Proof

Proof is offered for a booking when:

1. it comes from the university's timetable host, not any other calendar link;
2. it's confirmed (`Booking_Accepted`) and has a reference;
3. it starts within 10 minutes, which is when the previous booking ends, and hasn't finished.

Before then, the button counts down to when proof opens.

Opening proof goes to `/g/<code>/proof/<member>/<reference>`. That page asks the server to check the booking: the server downloads the booker's feed again, looks for the reference, and confirms it's still accepted and in its time window. Then the page draws the confirmation email: subject, sender, "To" the booker, the booking details in the email's format, and the line linking to Resource Booker's booking requests. The feed doesn't include the booking's own ID from the email link, so it links to the requests page instead.

A small footer gives the reference, when the booking was checked, and that the image was recreated by Bookings. Because proof is a real page, reloading it checks again, and a booking cancelled since then shows "Can't show proof".

## API

| Request | Does |
|---|---|
| `POST /api/groups` | Create a group with `{ name, url }` |
| `GET /api/groups/:code` | Members' names and colours |
| `POST /api/groups/:code/members` | Join with `{ name, url }` |
| `DELETE /api/groups/:code/members/:id` | Remove someone and their link |
| `GET /api/groups/:code/week?start=YYYY-MM-DD` | Everyone's bookings for the week starting that Monday |
| `GET /api/groups/:code/members/:id/proof?ref=RB-…` | Check a booking live for proof |

## Code

```
public/                    the page: index.html, app.js, style.css (no build step)
netlify/functions/api.mjs  the API above
lib/feeds.js               fetching, checking and caching feeds
lib/ics.js                 parsing iCal, repeats, and Scientia's fields
lib/bookings.js            which events are bookings, and which feeds are the university's
lib/london.js              UK-time helpers
lib/store.js               groups in Netlify Blobs
test/                      node --test
```

The tests cover UK time across the clock change, missing timezones, repeating and cancelled events, Scientia's fields, which bookings count, and which feeds are the university's.

To try it with feeds served from your own machine, run `ALLOW_LOCAL_FEEDS=1 npm run dev`. Don't set that in production.
