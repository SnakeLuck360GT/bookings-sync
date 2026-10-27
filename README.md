# Bookings

See which rooms your group has booked at the University of Manchester, for how long, and the gaps still to book.

Rooms booked through the university's room booking system appear in your timetable's iCal feed (as `Event type: Booking_Accepted`). Each person adds their timetable link once; the app shows only their bookings, never their classes.

Each group has a 6-character code (like `K7M2QX`). To join, enter your name and the code. If the name is already in the group you're signed in as them, so you can open it on another phone without pasting your link again. A new name is asked for a timetable link. Names are unique within a group.

For each day:

- **Status**: "No room booked yet", the room booked right now and until when, or the next room.
- **Gaps to book**: times between 9:00 and 18:00 that no booking covers (adjustable).
- **Booking left**: who hasn't used their one booking for that day.
- **Booked rooms**: each room with building, who booked it, times and total hours, plus a timeline.

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
