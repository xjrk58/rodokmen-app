/**
 * Operations only the server writes, never a Member or an Agent: an undo's restoreRecord steps
 * (defined with the others in proposals.ts), and setFamilyRoot, with which the server logs the
 * Owner marking or unmarking a Family root (tree-model spec, "Family roots") as a direct change
 * of the Owner. Neither changes facts, so neither needs evidence.
 */
import { z } from 'zod';
import { Id } from './common.js';
import type { OperationName } from './proposals.js';

/** Written only by the server, for PUT /api/persons/{id}/family-root. */
export const SetFamilyRoot = z
  .object({
    op: z.literal('setFamilyRoot'),
    personId: Id,
    familyRoot: z.boolean().describe('True marks the Person as a Family root, false unmarks them'),
  })
  .meta({ id: 'SetFamilyRoot', description: 'The Owner only, through PUT /api/persons/{id}/family-root: marks or unmarks a Family root' });

/** Who submits the operations that checkOperations (proposals.ts) checks. */
export interface CheckOptions {
  editor: boolean;
  /** An undo: its restoreRecord steps. */
  allowRestore?: boolean;
  /** The Owner's Family roots (setFamilyRoot). */
  allowFamilyRoots?: boolean;
}

/** Why an operation only the server writes is refused in these Proposals, or null when it is not refused. */
export function serverOnly(op: OperationName, options: CheckOptions): string | null {
  if (op === 'restoreRecord' && !options.allowRestore) return 'restoreRecord is written only by an undo';
  if (op === 'setFamilyRoot' && !options.allowFamilyRoots) return 'only the Owner marks Family roots, in settings or on the person page';
  return null;
}
