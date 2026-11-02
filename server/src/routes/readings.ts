import {
  ApiError,
  CreateReadingBody,
  IdParams,
  RateLimited,
  ReadingStatusView,
  ReadingView,
  ScanReadingSettings,
  UpdateScanReadingBody,
} from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertSwitchedOn, getReadingRow, readingStatus, readingView, requestReading, type ReadingDeps } from '../readings/service.js';
import { settingsView, updateScanSettings } from '../readings/settings.js';

const signedIn = { 401: ApiError, 429: RateLimited };
const ownerOnly = { 401: ApiError, 403: ApiError };

/**
 * Scan reading (scan-reading spec, ADR 0011): Members and Agents ask for a reading of their scans
 * and read it back; the Owner switches it on and sets the daily limit. While it is off, every
 * reading route answers 404. The browser only ever talks to these routes; the Anthropic API is
 * called by the server's reading queue alone.
 */
export async function readingRoutes(fastify: FastifyInstance, deps: ReadingDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/readings/status', {
    schema: {
      tags: ['Scan reading'],
      summary: 'Whether scan reading is on, and how many of your readings are left today. 404 while it is off',
      response: { 200: ReadingStatusView, 404: ApiError, ...signedIn },
    },
    handler: async (req) => readingStatus(deps, req.member!),
  });

  app.post('/api/readings', {
    config: { action: 'propose' },
    schema: {
      tags: ['Scan reading'],
      summary:
        'Ask for a reading of uploaded scans: their display copies, or the marked crops, are sent to Anthropic’s API and read into entries. Only your own uploads or images of a Citation; archive links are refused. Counts against your daily limit (429 with retryAt beyond it); 404 while scan reading is off',
      body: CreateReadingBody,
      response: { 202: ReadingView, 400: ApiError, 404: ApiError, 409: ApiError, ...signedIn },
    },
    handler: async (req, reply) => {
      const view = await requestReading(deps, req.member!, req.body);
      reply.code(202);
      return view;
    },
  });

  app.get('/api/readings/:id', {
    schema: {
      tags: ['Scan reading'],
      summary:
        'A reading: queued, running, failed (with why) or done, with what was read, the existing Persons each read name may be, and suggested Research leads. For its author and Editors; 404 while scan reading is off',
      params: IdParams,
      response: { 200: ReadingView, 404: ApiError, ...signedIn },
    },
    handler: async (req) => {
      await assertSwitchedOn(deps);
      return readingView(deps, await getReadingRow(deps.db, req.member!, req.params.id), req.member!);
    },
  });

  app.get('/api/settings/scan-reading', {
    config: { action: 'manageSettings' },
    schema: {
      tags: ['Scan reading'],
      summary: 'The switch and daily limit of scan reading, and the readings per Member and day of the last 30 days (Owner only)',
      response: { 200: ScanReadingSettings, ...ownerOnly },
    },
    handler: async () => settingsView(deps.db, deps.clock, deps.reader, deps.model),
  });

  app.put('/api/settings/scan-reading', {
    config: { action: 'manageSettings' },
    schema: {
      tags: ['Scan reading'],
      summary:
        'Switch scan reading on or off and set the daily limit per Member (Owner only). While it is on, scans are sent to Anthropic’s API to be read. It cannot be switched on without an API key on the server (409)',
      body: UpdateScanReadingBody,
      response: { 200: ScanReadingSettings, 400: ApiError, 409: ApiError, ...ownerOnly },
    },
    handler: async (req) => {
      await updateScanSettings(deps.db, deps.clock, req.member!, req.body, deps.reader !== null);
      return settingsView(deps.db, deps.clock, deps.reader, deps.model);
    },
  });
}
