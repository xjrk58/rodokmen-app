import { Health } from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { openApiDocument } from '../openapi.js';

const HEALTH_TIMEOUT_MS = 3_000;

export async function systemRoutes(fastify: FastifyInstance, deps: { db: Db; release: string }) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** The only API route open to anyone (tree-read-api spec); used by Caddy, deploys and the watchdog. */
  app.get('/api/health', {
    config: { public: true },
    schema: { tags: ['System'], summary: 'Health check: the API answers and the database is reachable', response: { 200: Health, 503: Health } },
    handler: async (_req, reply) => {
      const ok = await Promise.race([
        sql`select 1`.execute(deps.db).then(() => true, () => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS).unref()),
      ]);
      reply.header('cache-control', 'no-store');
      if (!ok) return reply.code(503).send({ status: 'degraded', database: 'unreachable', release: deps.release });
      return { status: 'ok' as const, database: 'ok' as const, release: deps.release };
    },
  });

  app.get('/api/openapi.json', {
    schema: { tags: ['System'], summary: 'This OpenAPI description (Members only)', response: { 200: z.record(z.string(), z.unknown()) } },
    handler: async () => openApiDocument(fastify),
  });
}
