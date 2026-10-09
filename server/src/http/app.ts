import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError, z } from 'zod';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import { leadInputSchema, quoteInputSchema, zodFields } from '../domain/schemas.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { createLead, listLeads } from '../services/leads.js';
import { calculateQuote } from '../services/quotes.js';
import { listSchemes } from '../services/schemes.js';

export interface AppDeps {
  db: Db;
  /** Extra routers (the agent) mounted under /api/v1 */
  extraRouters?: express.Router[];
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', zodFields(r.error));
  }
  return r.data;
}

export function createApp({ db, extraRouters = [] }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', db: db.kind, llmProvider: config.llmProvider });
  });

  api.get('/loan-schemes', async (_req, res) => {
    res.json({ data: await listSchemes(db) });
  });

  api.post('/quotes', async (req, res) => {
    const input = parse(quoteInputSchema, req.body);
    res.json(await calculateQuote(db, input));
  });

  api.post('/leads', async (req, res) => {
    const input = parse(leadInputSchema, req.body); // unknown keys (e.g. a client-sent loan amount) are dropped
    const key = req.header('Idempotency-Key') ?? undefined;
    const out = await createLead(db, input, { source: 'FORM', idempotencyKey: key });
    if (out.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(201).json(out.lead);
  });

  api.get('/leads', async (req, res) => {
    const q = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        planId: z.string().min(1).optional(),
        status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']).optional(),
      }),
      req.query,
    );
    res.json(await listLeads(db, q));
  });

  for (const r of extraRouters) api.use(r);

  api.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use('/api/v1', api);
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));

  // Single error handler: every error leaves the server in the same JSON shape, never a stack trace.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json(err.toBody());
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json(new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', zodFields(err)).toBody());
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json(new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON').toBody());
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json(new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large').toBody());
      return;
    }
    logger.error('unhandled error', err instanceof Error ? err.message : String(err));
    res.status(500).json(new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.').toBody());
  });

  return app;
}
