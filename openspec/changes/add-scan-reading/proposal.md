# Proposal

## Why

Most new evidence will be register pages: downloaded from an archive portal or photographed in a reading room. Transcribing an 1801 baptism in Latin Kurrent and typing every name, date and house number into forms is slow, and it is where relatives give up. The server should read the scan and draft the Proposal, the Member checks it, and the reading also says what to look for next.

## What Changes

- Scan reading: a Member uploads one or more scans with what they know (the Source or register, page, Place, years). The server reads them with Claude and drafts a Proposal: the transcription in the original language, and the Persons, Names, Events, Roles and Houses it finds.
- The draft lands as a Draft that the Member checks and submits; nothing is submitted without them. Everything read is marked "read by AI", and its confidence is at most normal.
- The reader suggests which existing Persons a name probably refers to, with reasons, for the Member to confirm per name.
- The reader suggests Research leads that follow from the entry, for example the parents' marriage or the godparent's house.
- The Owner switches scan reading on for the Tree, and sets a daily limit per Member.
- Agents can request a reading through the MCP server as well.

Out of scope: downloading scans from archive portals (Members supply them); reading whole register books in bulk; handwriting training; anything that submits without a person checking.

## Capabilities

### New Capabilities
- `scan-reading`: the Owner's switch and limits, reading scans into Drafts, matching names, and suggested leads.

### Modified Capabilities

## Impact

- New external dependency: the Anthropic API (ADR 0011), with an API key in the server's environment and private scans sent to it for reading.
- New server component: reading jobs with a queue, results stored with the upload, and usage counted per Member.
- App: "Read a scan" as a start point of the Propose flow, a result screen to check each entry, and match suggestions.
- Depends on `add-proposals-and-review` (Drafts, uploads), `add-research-leads` (suggested leads) and `add-agent-access` (MCP).
