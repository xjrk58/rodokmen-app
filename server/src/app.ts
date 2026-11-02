import fastifyCookie from '@fastify/cookie';
import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { AccountDeps } from './auth/accounts.js';
import { auth } from './auth/plugin.js';
import { ApiProblem, HTTP_ERROR_NAMES } from './auth/problem.js';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import type { Mailer } from './mail/mailer.js';
import { trackRoutes, transform, type RouteRecord } from './openapi.js';
import { accountRoutes } from './routes/accounts.js';
import { agentRoutes } from './routes/agents.js';
import { authRoutes } from './routes/auth.js';
import { pageRoutes } from './routes/pages.js';
import { proposalRoutes } from './routes/proposals.js';
import { readingRoutes } from './routes/readings.js';
import { ReadingJobs } from './readings/jobs.js';
import { configuredReader, type Reader } from './readings/reader.js';
import { systemRoutes } from './routes/system.js';
import { treeRoutes } from './routes/tree.js';
import { createImageStorage, type ImageStorage } from './storage/images.js';
import { systemClock, type Clock } from './clock.js';
import { messageOf, numberField, stringField } from './errors.js';

export interface AppDeps {
  config: Config;
  db: Db;
  mailer: Mailer;
  clock?: Clock;
  images?: ImageStorage;
  /**
   * The scan reader: by default the Anthropic API when ANTHROPIC_API_KEY is set, else none
   * (scan reading cannot be switched on). Tests pass one with recorded answers.
   */
  reader?: Reader | null;
  logger?: FastifyServerOptions['logger'];
  /** Test hook: extra routes registered after the real ones. */
  extraRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

export interface RodokmenApp extends FastifyInstance {
  routeRecords: RouteRecord[];
  /** The scan reading queue: `resume()` after start, `idle()` in tests. */
  readingJobs: ReadingJobs;
}

export async function buildApp(deps: AppDeps): Promise<RodokmenApp> {
  const { config, db, mailer } = deps;
  const clock = deps.clock ?? systemClock;
  const images = deps.images ?? createImageStorage(config.s3, clock);
  const reader = deps.reader === undefined ? configuredReader(config.scanReading) : deps.reader;

  const fastify = Fastify({
    logger: deps.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });
  const readingJobs = new ReadingJobs({ db, clock, images, reader, log: (msg, err) => fastify.log.error({ err }, msg) });
  const app: RodokmenApp = Object.assign(fastify, { routeRecords: trackRoutes(fastify), readingJobs });
  app.addHook('onClose', async () => readingJobs.close());

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyCookie);
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Rodokmen API',
        version: '0.1.0',
        description:
          'Read API of the Rodokmen Tree, Proposals and review, history, images, member accounts, Agents and sign-in. Every route except the health check and the sign-in steps needs a signed-in Member (session cookie) or an Agent token (Authorization: Bearer rdk_ag_…). Agents may only read and submit Proposals, within hourly limits (429 with retryAt beyond them).',
      },
      // Relative, so the committed description does not depend on where it was generated.
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'rdk_session' },
          agentToken: { type: 'http', scheme: 'bearer', description: 'An Agent token the Owner issued (rdk_ag_…)' },
        },
      },
      security: [{ session: [] }, { agentToken: [] }],
    },
    transform,
    transformObject: jsonSchemaTransformObject,
  });

  const cookieSecure = true;
  await app.register(auth, { db, clock, session: { idleDays: config.sessionIdleDays }, publicOrigin: config.publicOrigin, cookieSecure });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiProblem) {
      if (error.statusCode === 429 && error.extra.retryAt) {
        const wait = Math.ceil((new Date(error.extra.retryAt).getTime() - clock.now().getTime()) / 1000);
        reply.header('retry-after', String(Math.max(1, wait)));
      }
      return reply.code(error.statusCode).send({
        ...error.extra,
        statusCode: error.statusCode,
        error: HTTP_ERROR_NAMES[error.statusCode] ?? 'Error',
        message: error.message,
        code: error.code,
      });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: error.message, code: 'validation' });
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'response does not match its schema');
      return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong.', code: 'internal' });
    }
    const status = numberField(error, 'statusCode');
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ statusCode: status, error: HTTP_ERROR_NAMES[status] ?? 'Error', message: messageOf(error), code: stringField(error, 'code') ?? 'request' });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong.', code: 'internal' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found.', code: 'not_found' }));

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('referrer-policy')) reply.header('referrer-policy', 'same-origin');
  });

  const accountDeps: AccountDeps = { db, clock, mailer, publicOrigin: config.publicOrigin, session: { idleDays: config.sessionIdleDays } };
  await app.register(systemRoutes, { db, release: config.release });
  await app.register(treeRoutes, { db, clock, images });
  await app.register(proposalRoutes, { db, clock, images, mailer, publicOrigin: config.publicOrigin, log: (msg, err) => app.log.error({ err }, msg) });
  await app.register(readingRoutes, {
    db,
    clock,
    images,
    reader,
    jobs: readingJobs,
    model: config.scanReading.model,
    log: (msg, err) => app.log.error({ err }, msg),
  });
  await app.register(accountRoutes, accountDeps);
  await app.register(agentRoutes, { db, clock });
  await app.register(authRoutes, {
    ...accountDeps,
    cookieSecure,
    passkeys: { db, clock, rpId: config.rpId, rpName: 'Rodokmen', origin: config.publicOrigin },
  });
  await app.register(pageRoutes, { appDir: config.appDir, imageOrigin: await images.linkOrigin(), log: (msg) => app.log.info(msg) });
  if (deps.extraRoutes) await app.register(async (scope) => deps.extraRoutes!(scope));

  await app.ready();
  return app;
}
