# Bookings

See which rooms your group has booked at the University of Manchester, for how long, and the gaps still to book.

Rooms booked through the university's room booking system appear in your timetable's iCal feed (as `Event type: Booking_Accepted`). Each person adds their timetable link once; the app shows only their bookings, never their classes.

Each group has a 6-character code (like `K7M2QX`). Log in with your name and the code, on the home page or on the group's own page (where the code is filled in). A name already in the group logs you in as them, so you can open it on another phone without pasting your link again; a new name is asked for a timetable link. Names are unique within a group, and logins are remembered per browser.

For each day:

- **Status**: "No room booked yet", the room booked right now and until when, or the next room.
- **Gaps to book**: times between 10:00 (when booking opens) and 18:00 that no booking covers. A Book button opens Resource Booker for that day and time; gaps longer than the 3-hour limit offer two options, the first or last 3 hours.
- **Booking left**: who hasn't used their one booking for that day.
- **Booked rooms**: each booking in time order, with who booked it next to the room, the building, times and length, plus a timeline where longer bookings get bigger room numbers.
- **Booking opens 24 hours ahead**: slots that can't be booked yet show when they open ("Opens tomorrow 13:00"). Tapping one adds a calendar reminder for that moment, optionally repeating weekly (Google Calendar on Android, a calendar file elsewhere). One-off reminders link straight to the booking; weekly ones link to the group.

Tapping a booking shows its details and an **Open proof** button, which opens an image in a new tab of the booking laid out like the confirmation email (title, date, day, start and end, room, who booked it, the RB reference) to send to the group, noting it came from the university's timetable feed and when it was checked.

Timetable links stay on the server. The browser only receives names and bookings.

## Deploy (Netlify)

1. In Netlify, choose **Add new site → Import an existing project** and pick this repo.
2. Leave the build settings as they are (`netlify.toml` covers them) and deploy.

Groups are stored in Netlify Blobs, which needs no setup.

## Run locally

```sh
npm install
npm run dev     # http://localhost:8888
npm test
```

To test with feeds served from your own machine, start with `ALLOW_LOCAL_FEEDS=1 npm run dev`. Never set this in production.

## Layout

```
public/                    static front end (no build step)
netlify/functions/api.mjs  API: /api/groups/...
lib/ics.js                 iCal parsing, recurrence expansion, Scientia fields
lib/london.js              UK-time helpers
lib/feeds.js               fetching, validation and caching of feeds
lib/store.js               groups in Netlify Blobs
```
