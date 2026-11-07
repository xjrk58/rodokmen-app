import { ApiError, EraseBody, ErasurePreview, ErasureResult, IdParams } from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { erasePerson, erasurePreview, type ErasureDeps } from '../erasure/service.js';
import { gedcomOfTree } from '../export/run.js';

const ownerOnly = { 401: ApiError, 403: ApiError };

/**
 * Erasure (erasure spec) and the Owner's GEDCOM download (exports spec, "GEDCOM download for the
 * Owner"). Only the Owner may call them (actions `erase` and `downloadExport`, mayDo in
 * shared/src/rules.ts).
 */
export async function erasureRoutes(fastify: FastifyInstance, deps: ErasureDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/persons/:id/erasure', {
    config: { action: 'erase' },
    schema: {
      tags: ['Erasure'],
      summary: 'What erasing this Person would remove: their Names, Roles and Family links, the Events only they took part in, images, leads and history',
      params: IdParams,
      response: { 200: ErasurePreview, 404: ApiError, 409: ApiError, ...ownerOnly },
    },
    handler: async (req) => erasurePreview(deps, req.params.id),
  });

  app.post('/api/persons/:id/erase', {
    config: { action: 'erase' },
    schema: {
      tags: ['Erasure'],
      summary:
        'Erase a Living person at their request: from the Tree, the log (entries become "erased record") and the next Export. Only Living people; the confirmation names them. Cannot be undone',
      params: IdParams,
      body: EraseBody,
      response: { 200: ErasureResult, 400: ApiError, 404: ApiError, 409: ApiError, ...ownerOnly },
    },
    handler: async (req) => erasePerson(deps, req.member!, req.params.id, req.body.confirmation),
  });

  app.get('/api/export/family.ged', {
    config: { action: 'downloadExport' },
    schema: {
      tags: ['Export'],
      summary:
        'The Tree as a GEDCOM 5.5.1 file, with Living people reduced to name, sex, relationships and birth year, and no images: the same file as the nightly Export',
      response: { 200: z.string().describe('GEDCOM 5.5.1, UTF-8'), ...ownerOnly },
    },
    handler: async (_req, reply) => {
      reply
        .type('text/vnd.familysearch.gedcom; charset=utf-8')
        .header('content-disposition', 'attachment; filename="family.ged"')
        .header('cache-control', 'no-store');
      return gedcomOfTree(deps.db, deps.clock);
    },
  });
}
