import type { Action } from '@rodokmen/shared';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { actionOf } from './auth/plugin.js';

export interface RouteRecord {
  method: string;
  url: string;
  hasSchema: boolean;
  hasResponseSchema: boolean;
  /** Reachable without signing in. Read when the route is added, before a scope may mark it public (pages). */
  public: boolean;
  /** What the route does, for the role-and-action rule (auth/plugin.ts). */
  action: Action | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Records every route as it is added. Register before any route. */
export function trackRoutes(app: FastifyInstance): RouteRecord[] {
  const routes: RouteRecord[] = [];
  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const response: unknown = route.schema?.response;
    for (const method of methods) {
      routes.push({
        method: method.toUpperCase(),
        url: route.url,
        hasSchema: route.schema !== undefined,
        hasResponseSchema: isRecord(response) && Object.keys(response).some((code) => /^[23]\d\d$/.test(code)),
        public: route.config?.public === true,
        action: actionOf({ method, config: route.config }),
      });
    }
  });
  return routes;
}

export function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * The CI route comparison (tree-read-api spec, "Described by OpenAPI"): every /api route the
 * server registers must have a response schema and appear in the published description.
 * Returns one line per problem; empty means the description matches the routes.
 */
export function checkRouteCoverage(routes: readonly RouteRecord[], doc: unknown): string[] {
  const paths = isRecord(doc) && isRecord(doc.paths) ? doc.paths : {};
  const problems: string[] = [];
  for (const r of routes) {
    if (!r.url.startsWith('/api/') || r.method === 'HEAD' || r.method === 'OPTIONS') continue;
    // The catch-all for unknown API paths (routes/system.ts) only ever answers 404.
    if (r.url === '/api/*') continue;
    const label = `${r.method} ${r.url}`;
    if (!r.hasResponseSchema) problems.push(`${label} has no response schema`);
    const item = paths[toOpenApiPath(r.url)];
    if (!isRecord(item) || !item[r.method.toLowerCase()]) problems.push(`${label} is missing from the OpenAPI description`);
  }
  return problems;
}

/** jsonSchemaTransform, plus: public routes need no session in the description. */
export const transform: typeof jsonSchemaTransform = (input) => {
  const out = jsonSchemaTransform(input);
  return input.route.config?.public ? { ...out, schema: { ...out.schema, security: [] } } : out;
};

export function openApiDocument(app: FastifyInstance): Record<string, unknown> {
  const doc: unknown = app.swagger();
  if (!isRecord(doc)) throw new Error('@fastify/swagger returned no document');
  return doc;
}
