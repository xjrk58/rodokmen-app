# How to switch scan reading on

This guide shows you, as the Owner, how to let Members have register pages read by the server. While scan reading is on, the pages Members ask to have read are sent to Anthropic's API, in the USA. Read [what is sent, and why](../explanation/scan-reading.md) before you switch it on.

You need an account at the Anthropic Console with billing set up, and SSH access to the VPS ([Deploy guide](../../deploy/README.md)).

## Give the server an API key

1. In the Anthropic Console, create an API key for Rodokmen. Set a monthly spending limit there too: the daily limit below caps the number of readings, the Console caps the bill.
2. On the VPS, add it to `/opt/rodokmen/.env`:

   ```sh
   ANTHROPIC_API_KEY=sk-ant-…
   ```

   Only the API containers read it. The MCP server, the Backup and the browser never see it.

3. Deploy, so that the API starts with the key: run the `deploy` workflow by hand, with `rollback` left unticked ([Deploys](../../deploy/README.md#deploys)).

The API needs outbound HTTPS to `api.anthropic.com`. If the VPS firewall limits outbound traffic, allow it.

To use another model or effort than the defaults (`claude-opus-5-5`, `high`), set `RODOKMEN_SCAN_MODEL` and `RODOKMEN_SCAN_EFFORT` in the same file ([Configuration](../reference/configuration.md#api-server)). The [reader benchmark](run-the-reader-benchmark.md) helps you choose.

## Switch it on

1. In the app, open **Settings** and find **Scan reading**. It says what is sent. If it says the server has no Anthropic API key, the key did not reach the API; check `.env` and deploy again.
2. Set **Readings per Member per day** (default 10) and choose **Save**.
3. Tick **Send scans to Anthropic's API to be read**. It is saved at once.

Members now see **Read a scan** first under **Review → Propose**, with the readings they have left today. Agents can use `read_scan`.

## Watch the use

The same section shows the model and the readings today, and under **Readings, last 30 days** the readings per Member or Agent and day, with how many failed. Every reading asked for counts against the limit, also one that failed. The Console shows what they cost.

To change the limit, type the new number and choose **Save**. A Member who reaches it is told to fill in the form by hand until the next day (midnight, Prague time).

## Switch it off

Untick **Send scans to Anthropic's API to be read**. From then on:

- no page is sent; a reading still waiting in the queue fails without sending anything;
- **Read a scan** is no longer offered, and the reading routes answer 404;
- Proposals already submitted from readings are not affected; they keep their "read by AI" marks in review.

To stop for good, also remove `ANTHROPIC_API_KEY` from `.env`, deploy, and revoke the key in the Console.
