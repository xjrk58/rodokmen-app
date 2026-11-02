# Scan reading benchmark samples

The pages of the reader benchmark (add-scan-reading task 1.2) are **invented** (written by hand
for the benchmark) or **in the public domain** with a source that allows publishing them, and
**never** a scan from the Vault or of the family's own registers.

They live **outside this repository**: its guard (`.github/scripts/repo-guard.sh`) refuses raster
images outside `app/` and test fixtures, since they could be register pages. Keep them in a
directory of their own, laid out as below, and pass it to the run with `--samples <dir>`. This
directory holds only this description and an invented example of the format.

The benchmark needs 10 pages of handwriting the Tree will meet: Latin, Kurrent (German) and Czech
registers of the Czech lands, and mixed Latin and Kurrent, from about 1780 to 1900; baptisms,
marriages and burials; a few with faded or damaged places.

## One directory per page

```
<dir>/
  <id>/            a short name, such as la-1801-baptisms or kurrent-1852-burials
    page.jpg       the scan or photo (or page.png, page.webp), as a Member would add it
    truth.json     what the page says, transcribed by hand
```

`truth.json` (checked by `SampleTruth` in `../score.ts`):

```json
{
  "source": "Where the page is from and why it may be published, or 'Invented for the benchmark'",
  "script": "latin | kurrent | mixed | print",
  "languages": ["la"],
  "context": { "sourceTitle": "What a Member would call the register", "page": "41", "years": { "from": 1801, "to": 1801 }, "note": null },
  "transcription": "The whole page, line by line, in its original language and spelling",
  "entries": [{ "date": "1801-03-12", "house": "12", "names": ["Joannes Nowak", "Catharina"] }]
}
```

- `transcription` is compared character by character (CER): keep the page's spelling, case and
  abbreviations; mark what you cannot read with `[?]`, as the reader is asked to.
- `entries` lists, per register entry, the date as an EDTF date, the house number as digits (or
  `null`), and every name as the entry writes it.
- `"example": true` marks a sample that only shows the format (such as `example-invented-print`
  here, a printed page drawn as SVG, not handwriting); a run leaves it out unless
  `--include-examples` is given.

## Transkribus

Transkribus only transcribes. Run its public Kurrent model and its mixed Latin/Kurrent model on
the same `page` images, export each page as plain text, and save it as `<id>.txt`, one directory
per model. Then pass the directories to the run with
`--transkribus "Transkribus Kurrent=DIR,Transkribus Latin/Kurrent=DIR"`. For Transkribus the
benchmark scores the character error rate, and names and house numbers found in the text; dates
cannot be compared, since the text has them as written.
