import { ApiError, DescendantChart, DescendantChartQuery, HouseChart, HouseChartQuery, IdParams, RateLimited } from '@rodokmen/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ChartDeps } from '../charts/gather.js';
import { descendantChartFor, houseChartFor } from '../charts/service.js';

const answers = { 400: ApiError, 401: ApiError, 404: ApiError, 429: RateLimited };

/**
 * The Chart routes (tree-charts spec, "Who may make Charts"): the action `read`, for every Member
 * and Agent. The model has no coordinates and no words: the app lays it out and draws it. With
 * `sheet`, Living people are reduced as in an Export, whoever asks.
 */
export async function chartRoutes(fastify: FastifyInstance, deps: ChartDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/api/charts/descendants', {
    schema: {
      tags: ['Charts'],
      summary:
        'A Descendant chart from a Person or a Family: who is in it, in what order, with which facts and marks; with line, the Direct line to that descendant. Merged Persons are followed to the kept one',
      querystring: DescendantChartQuery,
      response: {
        200: DescendantChart,
        ...answers,
        422: ApiError.describe('line: the end of the Direct line does not descend from the start within 12 generations'),
      },
    },
    handler: async (req) => descendantChartFor(deps, req.query),
  });

  app.get('/api/charts/house/:id', {
    schema: {
      tags: ['Charts'],
      summary: 'A House chart: the Families who lived at a House, in time order, with their periods, house numbers and links to earlier rows; at most 80 rows',
      params: IdParams,
      querystring: HouseChartQuery,
      response: { 200: HouseChart, ...answers },
    },
    handler: async (req) => houseChartFor(deps, req.params.id, req.query),
  });
}
