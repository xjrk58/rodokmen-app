# How to run the reader benchmark

This guide shows you how to compare Claude models, and Transkribus, at reading register pages, so that you can choose the model scan reading uses (`RODOKMEN_SCAN_MODEL`). The benchmark reads each sample page through the server's own reader, with the same instructions, schema and image preparation as a real reading, and scores it against a transcription made by hand. Each Claude reading is a paid request: 10 pages and two models are 20 requests.

You need a checkout of the repo after `pnpm install`, and an Anthropic API key. No database or running server is needed.

## Prepare the samples

Use pages that are **invented** or **in the public domain**, with a source that allows publishing them. **Never** use a scan from the Vault or of the family's own registers.

1. Make a directory **outside the repo**, such as `~/scan-benchmark-samples`. The repo's guard refuses raster images outside `app/` and test fixtures, and a sample page must not end up in a commit.
2. Collect about 10 pages of the handwriting the Tree will meet: Latin, Kurrent and Czech registers of the Czech lands, and mixed Latin and Kurrent, from about 1780 to 1900; baptisms, marriages and burials; a few with faded or damaged parts.
3. For each page, make a sub-directory with a short name, such as `la-1801-baptisms`, holding `page.jpg` (or `.png`, `.webp`) and `truth.json`: the page transcribed by hand, keeping its spelling, case and abbreviations, and per entry its date, house number and names. The format, with an example, is in [`server/scripts/scan-benchmark/samples/README.md`](../../server/scripts/scan-benchmark/samples/README.md).

## Add Transkribus (optional)

Transkribus only transcribes, so it is scored on the transcription, names and house numbers, not on dates.

1. In Transkribus, run its public Kurrent model, and its mixed Latin and Kurrent model, on the same page images.
2. Export each page as plain text, and save it as `<sample name>.txt`, one directory per model, such as `~/scan-benchmark-transkribus/kurrent/la-1801-baptisms.txt`.

## Run it

From the repo root, with the key in the environment for this command only:

```sh
ANTHROPIC_API_KEY=sk-ant-… pnpm --filter @rodokmen/server bench:scan \
  --samples ~/scan-benchmark-samples \
  --transkribus "Transkribus Kurrent=$HOME/scan-benchmark-transkribus/kurrent,Transkribus Latin/Kurrent=$HOME/scan-benchmark-transkribus/mixed" \
  --out ~/scan-benchmark-results
```

Options:

| Option               | Default                             | Meaning                                                                  |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `--samples DIR`      | the example in the repo             | the sample pages                                                         |
| `--models A,B`       | `claude-opus-5-5,claude-sonnet-5-5` | the Claude models to compare                                             |
| `--effort E`         | `high`                              | `low`, `medium`, `high`, `xhigh` or `max`, as `RODOKMEN_SCAN_EFFORT`     |
| `--transkribus LIST` | none                                | `Name=DIR` pairs, comma-separated                                        |
| `--out DIR`          | `server/scan-benchmark-results`     | where the results go (Git ignores the default); better outside the repo  |
| `--include-examples` | off                                 | also read samples marked `"example": true`, such as the invented example |

To check the setup first without paying for 20 readings, run it once on the invented example alone, with `--include-examples --models claude-sonnet-5-5` and no `--samples`. Relative paths are taken from `server/`, where pnpm runs the script, so give absolute ones.

## Read the results

The run prints a table and writes to `--out`:

- `summary.md`: per reader, the pages read and failed, the character error rate (CER) of the transcriptions, the names found and the names right, the dates and the house numbers right, and the tokens in and out;
- `summary.json`: the same, page by page;
- one directory per reader with its reading of each page.

Choose the model that reads names and house numbers best at a cost you accept; the readings also show whether a model leaves illegible values empty rather than guessing. Set it as `RODOKMEN_SCAN_MODEL` on the server ([switch scan reading on](switch-on-scan-reading.md)), and record the table and the choice in `openspec/changes/add-scan-reading/design.md`.
