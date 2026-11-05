import { MAX_PROPOSAL_OPERATIONS } from '@rodokmen/shared';
import { describe, expect, it } from 'vitest';
import { splitProposal, type PlannedOp, type PlannedProposal } from '../src/vault-import/plan.js';

const op = (name: string, key: string): PlannedOp => ({ op: { op: name }, key });
/** A Source note's Proposal: its Citation, then `people` Persons of four operations each. */
const proposal = (people: number): PlannedProposal => ({
  key: 'source-note:index',
  kind: 'source',
  note: 'Vault: sources/index.md',
  path: 'sources/index.md',
  hash: 'hash',
  files: [{ path: 'attachments/sources/index.jpg', type: 'image/jpeg' }],
  ops: [
    op('createCitation', 'citation:index'),
    ...Array.from({ length: people }, (_, i) => [
      op('createPerson', `person:${i}`),
      op('createEvent', `event:${i}`),
      op('addRole', `role:${i}`),
      op('attachCitation', `cite:${i}`),
    ]).flat(),
  ],
});

describe('splitting a Proposal too big for the server', () => {
  it('leaves a Proposal within the limit as it is', () => {
    const p = proposal(10);
    expect(splitProposal(p)).toEqual([p]);
  });

  it('keeps every operation, in order, in parts within the limit', () => {
    const p = proposal(261);
    const parts = splitProposal(p);
    expect(parts.length).toBe(4);
    expect(parts.flatMap((part) => part.ops)).toEqual(p.ops);
    for (const part of parts) expect(part.ops.length).toBeLessThanOrEqual(MAX_PROPOSAL_OPERATIONS);
  });

  it('cuts between Persons, so that a Person stays with their facts and every part has a Citation', () => {
    const parts = splitProposal(proposal(261));
    for (const part of parts.slice(1)) expect(part.ops[0]!.op.op).toBe('createPerson');
    for (const part of parts) expect(part.ops.some((o) => o.op.op === 'attachCitation' || o.op.op === 'createCitation')).toBe(true);
  });

  it('cuts at the limit when no Person starts within it', () => {
    const p = { ...proposal(0), ops: Array.from({ length: 7 }, (_, i) => op('addLabel', `label:${i}`)) };
    expect(splitProposal(p, 3).map((part) => part.ops.length)).toEqual([3, 3, 1]);
  });

  it('names the parts for the reviewer, uploads with the first, and counts the note as imported with the last', () => {
    const parts = splitProposal(proposal(100), 150);
    expect(parts.map((part) => part.note)).toEqual(parts.map((_, i) => `Vault: sources/index.md (part ${i + 1} of ${parts.length})`));
    expect(new Set(parts.map((part) => part.key)).size).toBe(parts.length);
    expect(parts[0]!.files).toHaveLength(1);
    for (const part of parts.slice(1)) expect(part.files).toEqual([]);
    for (const part of parts.slice(0, -1)) expect([part.path, part.hash]).toEqual([null, null]);
    expect([parts.at(-1)!.path, parts.at(-1)!.hash]).toEqual(['sources/index.md', 'hash']);
  });
});
