import express from 'express';
import { z } from 'zod';
import { zodFields } from '../domain/schemas.js';
import { AppError } from '../errors.js';
import type { AgentService } from './agent.js';

const sid = z.string().min(8).max(80);

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', zodFields(r.error));
  return r.data;
}

export function agentRouter(agent: AgentService): express.Router {
  const r = express.Router();

  r.post('/agent/messages', async (req, res) => {
    const { sessionId, message } = parse(z.object({ sessionId: sid, message: z.string().trim().min(1).max(1000) }), req.body);
    res.json(await agent.handleMessage(sessionId, message));
  });

  r.post('/agent/confirm', async (req, res) => {
    const { sessionId, token } = parse(z.object({ sessionId: sid, token: z.string().min(8).max(80) }), req.body);
    const out = await agent.confirm(sessionId, token);
    res.status(201).json(out);
  });

  r.post('/agent/cancel', (req, res) => {
    const { sessionId } = parse(z.object({ sessionId: sid }), req.body);
    res.json({ reply: agent.cancel(sessionId) });
  });

  return r;
}
