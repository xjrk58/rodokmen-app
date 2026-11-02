/**
 * The rules of scan reading (scan-reading and evidence-media specs, ADR 0011), as small pure
 * functions: no I/O, no `await`, no regular expressions. The server gathers the inputs (the
 * Owner's switch and daily limit, the Member's readings today, the requested scans, a
 * Proposal's Citations) and calls these; the model's reading, the database and the API call
 * are the trust boundary.
 *
 * Proved with LemmaScript (ADR 0009, docs/verification.md): each `//@ verify` function meets its
 * `//@` specification, which states the requirement's scenarios.
 */

/** Whether one more reading may be made, and if not, why: `off` or `limit`. */
export interface ReadDecision {
  allowed: boolean;
  reason: string;
}

/**
 * The Owner's switch and the daily limit (scan-reading spec, "The Owner switches it on";
 * evidence-media spec, "Images sent for reading"): nothing is read while scan reading is off,
 * and a Member who made `dailyLimit` readings today is refused until the next day. The server
 * counts the readings of the day (Prague time) under a lock and asks this before it queues one.
 */
export function mayRead(enabled: boolean, usedToday: number, dailyLimit: number): ReadDecision {
  //@ verify
  //@ contract scan-reading: The Owner switches it on
  //@ contract evidence-media: Images sent for reading
  // Scenario "Switched off": with the switch off, nothing is read.
  //@ ensures !enabled ==> !\result.allowed && \result.reason === 'off'
  // Scenario "Daily limit": a Member who used their daily limit is refused.
  //@ ensures enabled && usedToday >= dailyLimit ==> !\result.allowed && \result.reason === 'limit'
  // Below the limit, with the switch on, the reading is made.
  //@ ensures enabled && usedToday < dailyLimit ==> \result.allowed && \result.reason === 'ok'
  //@ ensures \result.allowed ==> enabled && usedToday < dailyLimit
  if (!enabled) return { allowed: false, reason: 'off' };
  if (usedToday >= dailyLimit) return { allowed: false, reason: 'limit' };
  return { allowed: true, reason: 'ok' };
}

/** A scan a reading asks for: an upload, and whether the Member marked a crop of it. */
export interface ScanRequest {
  uploadId: string;
  crop: boolean;
}

/** An image to send to the reading service: which upload, and which copy of it. */
export interface ImageToSend {
  uploadId: string;
  /** `display` (the WebP display copy) or `crop` (the part the Member marked). */
  copy: string;
}

/** The copy of one requested scan that may be sent: its crop when the Member marked one, else its display copy. */
export function copyToSend(r: ScanRequest): ImageToSend {
  //@ verify
  //@ ensures \result.uploadId === r.uploadId
  //@ ensures \result.copy === 'crop' || \result.copy === 'display'
  //@ ensures r.crop ==> \result.copy === 'crop'
  //@ ensures !r.crop ==> \result.copy === 'display'
  return { uploadId: r.uploadId, copy: r.crop ? 'crop' : 'display' };
}

/**
 * What goes to the reading service for one reading (evidence-media spec, "Images sent for
 * reading"): only the scans the reading asked for, each as its display copy or its marked crop,
 * never the original file; and with the switch off, nothing at all. The job asks again when it
 * starts, so a reading queued before the Owner switched reading off sends nothing.
 */
export function imagesToSend(enabled: boolean, requested: readonly ScanRequest[]): ImageToSend[] {
  //@ verify
  //@ contract evidence-media: Images sent for reading
  //@ contract scan-reading: The Owner switches it on
  // Scenario "Switched off": no request with an image goes to the reading service.
  //@ ensures !enabled ==> \result.length === 0
  // Scenario "Reading one page": exactly the scans asked for, in their order ...
  //@ ensures enabled ==> \result.length === requested.length
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].uploadId === requested[i].uploadId)
  // ... each as its marked crop, or else its display copy: never the original file.
  //@ ensures forall(i: nat, i < \result.length && requested[i].crop ==> \result[i].copy === 'crop')
  //@ ensures forall(i: nat, i < \result.length && !requested[i].crop ==> \result[i].copy === 'display')
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].copy !== 'original')
  if (!enabled) return [];
  const out: ImageToSend[] = [];
  for (const r of requested) {
    //@ invariant out.length === _r_idx
    //@ invariant forall(j: nat, j < out.length ==> out[j] === copyToSend(requested[j]))
    out.push(copyToSend(r));
  }
  return out;
}

/**
 * The confidence a Citation drafted by the reader may have (scan-reading spec, "The machine's
 * reading is marked and modest"): at most normal. Lower confidences stay as they are; high and
 * very high become normal. The server applies it to every new Citation of a Proposal drafted
 * from a reading when the Proposal arrives, whatever the device sent.
 */
export function capConfidence(confidence: string, readerDrafted: boolean): string {
  //@ verify
  //@ contract scan-reading: The machine's reading is marked and modest
  // A Citation the reader drafted has at most normal confidence ...
  //@ ensures readerDrafted ==> \result === 'very_low' || \result === 'low' || \result === 'normal'
  // ... so a submitted high or very high confidence is lowered to normal ...
  //@ ensures readerDrafted && (confidence === 'high' || confidence === 'very_high') ==> \result === 'normal'
  // ... and a lower one is kept.
  //@ ensures readerDrafted && (confidence === 'very_low' || confidence === 'low' || confidence === 'normal') ==> \result === confidence
  // Citations a person drafted keep their confidence.
  //@ ensures !readerDrafted ==> \result === confidence
  if (!readerDrafted) return confidence;
  if (confidence === 'very_low' || confidence === 'low') return confidence;
  return 'normal';
}

/**
 * Whether a value is still marked "read by AI" (scan-reading spec, "The machine's reading is
 * marked and modest"): it came from the reader, and the Member has neither confirmed nor
 * changed it. The app keeps these marks while the Member checks a reading (its mirror in
 * app/src/reading-draft.js is tested against this), and sends them with the Proposal.
 */
export function stillReadByAi(fromReader: boolean, confirmed: boolean, changed: boolean): boolean {
  //@ verify
  //@ contract scan-reading: The machine's reading is marked and modest
  // Scenario "Member confirms": a value the Member corrected, or confirmed, is no longer marked.
  //@ ensures changed ==> !\result
  //@ ensures confirmed ==> !\result
  // Every value the reader produced is marked until then; a value the Member typed never is.
  //@ ensures fromReader && !confirmed && !changed ==> \result
  //@ ensures !fromReader ==> !\result
  return fromReader && !confirmed && !changed;
}
