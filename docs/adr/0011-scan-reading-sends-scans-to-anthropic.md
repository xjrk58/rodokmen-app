# Scan reading sends scans to Anthropic's API, and only when the Owner allows it

Relatives contribute from phones, so register pages are read on the server, not by each Member's own agent. The server sends a scan's display copy or crop, the Member's context and the names the Tree knows for that Place to the Anthropic API, and gets back a transcription and structured entries. That means private family scans leave our servers. Scan reading is therefore off until the Owner switches it on, and a daily limit keeps the cost in check. The reading only ever becomes a Draft or an Agent Proposal that a person checks. Deciding who a name refers to stays a deterministic rule in our code, not the model's guess.

## Considered Options

- **Only external Agents read scans (through MCP)**: kept as an extra path, but not enough on its own; relatives on phones don't run agents.
- **A self-hosted handwriting model**: rejected for now; nothing open reads Latin and Kurrent registers as well, and running one needs a GPU we don't have.
