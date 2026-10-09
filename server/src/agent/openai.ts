import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import type { ChatMessage, LlmProvider, LlmResult, ToolDef } from './types.js';

interface Opts {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Base backoff for 429/5xx retries; tests set this to 0. */
  backoffMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One adapter for every OpenAI-compatible chat-completions endpoint:
 * Gemini (https://generativelanguage.googleapis.com/v1beta/openai) and Ollama (http://localhost:11434/v1).
 * Handles 429/5xx with short backoff and surfaces a friendly 503 so the chat UI can say "assistant is busy".
 */
export function openAiCompatible(o: Opts): LlmProvider {
  return {
    name: o.name,
    async chat(messages: ChatMessage[], tools: ToolDef[]): Promise<LlmResult> {
      const body = {
        model: o.model,
        temperature: 0.2,
        messages: messages.map((m) => {
          if (m.role === 'assistant' && m.tool_calls?.length) {
            return {
              role: 'assistant',
              content: m.content ?? '',
              tool_calls: m.tool_calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.arguments },
                ...(c.extra !== undefined ? { extra_content: c.extra } : {}),
              })),
            };
          }
          return m;
        }),
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: 'auto',
      };

      let lastStatus = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        let res: Response;
        try {
          res = await fetch(`${o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(o.apiKey ? { Authorization: `Bearer ${o.apiKey}` } : {}) },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          });
        } catch (e) {
          logger.error(`LLM network error (${o.name})`, e instanceof Error ? e.message : String(e));
          throw new AppError(503, 'LLM_UNAVAILABLE', 'The assistant is unavailable right now. Please try again, or use the form.');
        }
        lastStatus = res.status;
        if (res.status === 429 || res.status >= 500) {
          logger.warn(`LLM ${o.name} returned ${res.status}, attempt ${attempt + 1}/3`);
          await sleep((o.backoffMs ?? 800) * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          logger.error(`LLM ${o.name} error ${res.status}`, (await res.text()).slice(0, 300));
          throw new AppError(502, 'LLM_ERROR', 'The assistant hit a problem. Please try again, or use the form.');
        }
        const json = (await res.json()) as any;
        const msg = json?.choices?.[0]?.message;
        return {
          content: typeof msg?.content === 'string' && msg.content.length ? msg.content : null,
          toolCalls: (msg?.tool_calls ?? []).map((c: any, i: number) => ({
            id: c.id || `call_${Date.now()}_${i}`,
            name: c.function?.name ?? '',
            arguments:
              typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}),
            ...(c.extra_content !== undefined ? { extra: c.extra_content } : {}),
          })),
        };
      }
      throw new AppError(
        503,
        'LLM_BUSY',
        lastStatus === 429
          ? 'The assistant is busy right now. Please try again in a few seconds.'
          : 'The assistant is unavailable right now. Please try again, or use the form.',
      );
    },
  };
}
