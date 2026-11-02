# Offline and the app

Genealogy happens in places with poor signal: an archive's reading room, a village churchyard, a relative's kitchen in the hills. So Rodokmen is built to keep working without a connection, but only as far as that stays simple and safe. Reading works offline; writing works offline as Drafts; nothing is ever synchronised behind the Member's back.

## One app, installed from the browser

Rodokmen is a progressive web app, and the only interface there is (ADR 0007): no app store, no separate admin site. On Android Chrome it installs to the home screen with its own icon and opens without browser controls. One codebase then serves phones and computers, and a release reaches everyone at once.

## The map works after one visit

The public map is designed to work entirely offline once it has been opened. The service worker stores the app itself and all of `app/data/` (districts, Municipalities, archives, layers) on the first visit. Search, archive lookup, the archive regions and the borders then need no network at all.

Map tiles are the exception. They are cached only as the reader views them, at most 2,000, the least recently used dropped first, and never downloaded in bulk. OpenStreetMap's tile policy forbids offline use and bulk downloads of its tiles. So offline, the borders and places are all there, and the base map shows what the reader has seen before.

## The family data a Member last loaded

For signed-in Members, the app keeps the Tree records they have viewed (people, trees, places, citations) on the device, at most 400, the least recently used dropped first. Offline, those pages still open, marked "as of" with the time they were loaded. Nothing is kept for someone who is not signed in, and signing out, or a session ended from another device, empties it.

This is a cache, not a copy of the Tree. It holds only what the Member has opened, which keeps it small, and means a lost phone does not carry the whole Tree.

## Writing offline: Drafts, not sync

A Member can write a Proposal offline. It is kept on the device as a Draft, with its photos, and survives closing the app. Back online, the app offers to submit it.

Full offline synchronisation, where edits made on several devices are merged automatically, was rejected (ADR 0003). It would be the most expensive part of the system to build and the hardest to get right, and it would merge changes nobody reviewed. Rodokmen already has a person who looks at every change: the Editor. So each Draft records the version of every record it was based on, and if the Tree changed meanwhile, the Editor sees both values and decides ([Proposals and review](proposals-and-review.md)).

Two smaller choices make this safe. Each Draft has an idempotency key, so a submit interrupted by a dropped connection can be repeated without creating the Proposal twice. And because browsers may delete stored data when space runs low, the app shows how much storage Drafts use and warns about Drafts that have waited more than a week.

## Updates never interrupt reading

When a new version is deployed, the open app downloads it in the background and offers "New version, reload". It switches only when the reader taps that, so a page being read, or a Draft being typed, is never replaced underneath them. Every change to the app's files gives it a new version stamp, which is what tells the service worker there is something new.
