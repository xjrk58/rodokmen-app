# Build the Tree backend from scratch, borrowing proven ideas

The Tree needs review before publish (ADR 0001), automatic privacy for Living people, an API for the map app and for Agents, and self-hosting on an EU server. We build our own backend rather than run an existing genealogy system or a general backend platform. In exchange for building logins, roles, history and GEDCOM export ourselves, we get one product with one interface and a model shaped around Proposals, Houses and Citations with page images. We deliberately copy what the existing systems got right instead of inventing it: webtrees' rules for treating people as living and its moderation of pending changes, the event and place model of Gramps, Gramps Web's undo of whole change sets, and GEDCOM for exchange.

## Considered Options

- **webtrees**: the only ready-made fit (moderation, automatic living-people privacy). Rejected; its API depends on a small third-party module.
- **Gramps Web**: strong API and active, but no review before publish, and privacy is a manual flag.
- **Supabase, PocketBase, Directus**: we would still write the whole genealogy model, plus run and adapt a platform around it.
