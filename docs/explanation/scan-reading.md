# Scan reading: what is sent to Anthropic, and why

Reading an old register page is the slowest part of family research. The handwriting is Kurrent or a Latin hand, the spelling changes from entry to entry, and the page has a dozen people on it. Scan reading lets the server read the page with a Claude model and draft the entries, so that a Member, often on a phone, checks a reading instead of typing one. This page explains why it works the way it does: why on the server, why it is off until the Owner switches it on, what leaves our servers, and why the machine never decides anything on its own. The routes and limits are in the [scan reading reference](../reference/scan-reading.md); the decision itself is [ADR 0011](../adr/0011-scan-reading-sends-scans-to-anthropic.md).

## Why the server reads, not each Member's assistant

Rodokmen already lets an AI assistant work as an Agent through MCP. That path stays: an Agent can have scans read with `read_scan` too. But the relatives who find pages are mostly on phones, in an archive's reading room or at home with a photo, and they do not run assistants. So the server does the reading, and the Member only adds the page and checks the result.

The model sits behind the API, like everything else. The browser talks only to Rodokmen's own routes, and the server calls Anthropic's API from its reading queue. The API key stays in the server's environment, the app's content security policy needs no new origin, and a Member never needs an account anywhere else.

## Why it is off until the Owner switches it on

Everywhere else, the family's data stays on our VPS in the EU ([Privacy](privacy.md#where-data-goes-outside)). Scan reading is the one exception: a page sent for reading goes to Anthropic's API, in the USA. Register pages are old, but they are the family's own copies, and they name people. That is a choice the family should make on purpose, once, and be able to undo. So:

- the server reads nothing until it has an API key **and** the Owner has switched scan reading on in **Settings**;
- the switch says, in the app, what is sent and where;
- switching it off stops it at once: new readings are refused, and a reading still waiting in the queue sends nothing;
- a daily limit per Member (and per Agent) keeps the cost in check, since every reading is a paid request; the Owner sees the readings per Member and day.

That nothing is read or sent while the switch is off, and that a Member at the limit is refused, are proved rules (see below).

## What leaves our servers

For each reading the server sends three things, and nothing else:

- **The page.** Its display copy, the same WebP image the app shows, at most 2,000 pixels on its longest side; or, if the Member marked one entry, only that part, cut from the original and sent as a WebP of the same size. The original file never leaves the server. Nor does a portrait, or the image of another Member's upload: a Member can have read only their own uploads and images already attached to a Citation.
- **What the Member knows.** The register's title, the page or frame, the Place and its Parish, the years and the Member's note, as typed. These help the model place the page. The link to the archive's viewer is kept for the Citation but not sent, and the server never fetches it: portals allow viewing, not copying by machine.
- **Names the Tree already has there.** The given names and the surnames of Persons with Events in that Place or its Parish, as two plain lists, so that the model recognises "Nowak" when it sees a blurred "Now.k". Only Persons who are not [Living](privacy.md#living-people) contribute, at most 300 of them, and nothing else about anyone goes out: no dates, no Houses, no relations, and no link between a given name and a surname.

The model's answer comes back as JSON in a fixed schema: a transcription of each page, the entries with their dates, house numbers and persons, what could not be read, and next steps the entry implies. The server checks the answer against that schema; one that does not fit is a failed reading, never patched up by guessing.

## The machine reads; people decide

A model is good at reading a hand that would take a person an hour. It is also good at sounding sure when it is not. So everything the reader produces is a suggestion that a person checks, and three rules make sure it cannot slip into the Tree as fact.

**A reading becomes a Draft, then a Proposal.** It never changes the Tree. The Member checks each entry against the scan beside it, corrects what is wrong and confirms it, then submits a [Proposal](proposals-and-review.md) that an Editor reviews like any other. An Agent's reading goes the same way, through `propose_reading`.

**What the machine read stays marked.** Every value still as the reader produced it carries a "read by AI" mark, in the Draft and in review, until the Member confirms or changes it. So an Editor sees at a glance which names and dates a person has looked at. And a Citation made from a reading has at most **normal** confidence, whatever the form says: a machine's reading is never "certain" evidence.

**Who a name refers to is our rule, not the model's guess.** The model only reads the name as written. Which existing Person it may be is decided by fixed rules in our code: the server looks up Persons by the variants of the read given name and surname (Joannes and Jan, Nowak and Novák), and scores each by whether the name matches, whether they lived at the read house number, whether their birth fits the years the role allows, whether they had Events at the Place, and whether their partner is in the same entry. The name, the House and the years each outweigh everything below them together, so "Jan Novák of čp. 12, born 1770" always ranks above a stranger of the same name elsewhere. The Member then taps the Person, or **New Person**: nobody is created without that choice, so a reading cannot fill the Tree with duplicates.

## Names in their own language

A register writes names in its own language: a Latin baptism has "Joannes", a German one "Johann". The reading keeps each name as written, with its language tag (`la`, `de`, `cs`). A new Person gets that name: the child of a baptism or birth entry as their birth name, everyone else as another form of their name (type `other`), since a priest's Latin is rarely what the family called them. For a Person the Tree already has, the matching folds the variants together, so "Joannes Nowak" in a Latin entry finds Jan Novák rather than becoming a second Person.

## Next steps, not facts

An entry often points to another: a child's parents married somewhere some years before; a godparent came from a House in another village. The reader notes such hints, and the server turns them into suggested Research leads, in Czech and English, with the Parish, the archive that holds its registers and, when the Tree has one, the register that covers those years. A suggestion states no fact about the family. The Member keeps it as a [Research lead](research-leads.md), which every Member then sees, or dismisses it.

## What is proved, and what is tested

The rules that decide what may be sent, and how a reading is weighed, are pure functions in `shared/src/`, proved with LemmaScript ([Proofs](proofs.md)):

- with the switch off, nothing is read and no image is sent; at the daily limit, the next reading is refused (`mayRead`, `imagesToSend`);
- exactly the requested scans are sent, in order, each as its marked part or else its display copy, never the original (`imagesToSend`);
- only the Owner may change the settings (`mayDo`);
- a Citation from a reading has at most normal confidence, and a value stays marked until it is confirmed or changed (`capConfidence`, `stillReadByAi`);
- a candidate with the read name, House and years ranks above any without all three (`scoreCandidate`, `ranksAbove`).

The rest is tested: that the server sends the bytes of exactly those copies and refuses portraits and others' uploads, that the switch states where scans go, the folding of names into variants, and the query that gathers candidates from the Tree. The tests use recorded API answers and a fake reader; no test calls Anthropic's API. [Verification](../verification.md) lists each proof and what it assumes.

## What it does not do

- It does not read archive portals. A Member saves the page as an image or photographs it.
- It does not read pages on its own. Every reading is asked for by a Member or an Agent, one at a time.
- It does not choose its model by itself. The Owner picks it with `RODOKMEN_SCAN_MODEL`, and the reader benchmark compares models with Transkribus on invented and public-domain pages ([run the reader benchmark](../how-to/run-the-reader-benchmark.md)).
