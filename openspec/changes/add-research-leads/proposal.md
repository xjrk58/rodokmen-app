# Proposal

## Why

Genealogy is mostly deciding where to look next and remembering where you already looked. The Vault kept that in `log/` and `plans/` notes. The Tree has nowhere for it, so relatives and Agents would repeat each other's searches, and nobody would see the open questions. Scan reading and gap finding both need a place to put their suggestions too.

## What Changes

- A new kind of record, the Research lead: a question, where to look (archive, register Source, years, pages, Place), why, the linked Persons and Places, a status (open, in progress, found, not found), who is working on it, and the outcome.
- Closing a lead records what was searched, so a "not found" is as useful as a find.
- Members and Agents create and edit leads directly, without review, because leads are plans, not facts. A fact found through a lead still arrives as a Proposal, linked to the lead.
- A rule-based gap finder suggests leads: a Person without a baptism or birth Citation, missing parents where the Parish and years are known, a marriage without a record. It names the register to check, using archive lookup and the registers in the Tree.
- Leads appear on person pages, place sheets and in their own list, filterable by status, Place, archive and assignee.

Out of scope: AI-suggested leads (they come with `add-scan-reading`); importing the Vault's `log/` and `plans/` (done by `add-vault-import` once this change exists); reminders or due dates.

## Capabilities

### New Capabilities
- `research-leads`: Research leads, their lifecycle, search records, and the gap finder.

### Modified Capabilities

## Impact

- New tables for leads, their links and their search records, plus API routes. The MCP server gains lead tools (list, create, update, close).
- App: a Leads list, leads on person pages and place sheets, and a "Start from this lead" path into the Proposal forms.
- Depends on `add-proposals-and-review` (Proposals link to leads) and `add-agent-access` (Agent authorship). `add-vault-import` then maps `log/` and `plans/` to leads.
