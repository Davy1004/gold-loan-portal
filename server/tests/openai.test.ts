import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiCompatible } from '../src/agent/openai.js';
import { TOOL_DEFS } from '../src/agent/tools.js';

const provider = () =>
  openAiCompatible({ name: 'gemini:test', baseUrl: 'https://example.test/v1beta/openai/', model: 'm', apiKey: 'KEY', backoffMs: 0 });
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible adapter (Gemini / Ollama) - tested against a stubbed endpoint', () => {
  it('sends tools generated from the Zod schemas and the bearer key; parses tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reply(200, {
        choices: [{ message: { content: null, tool_calls: [{ id: 'abc', type: 'function', function: { name: 'calculate_quote', arguments: '{"netWeightGrams":45}' } }] } }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await provider().chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'x', name: 'get_loan_schemes', arguments: '{}' }] },
        { role: 'tool', tool_call_id: 'x', name: 'get_loan_schemes', content: '{"data":[]}' },
      ],
      TOOL_DEFS,
    );
    expect(out.toolCalls).toEqual([{ id: 'abc', name: 'calculate_quote', arguments: '{"netWeightGrams":45}' }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/v1beta/openai/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer KEY');
    const body = JSON.parse(init.body);
    expect(body.tools.map((t: any) => t.function.name)).toEqual(['get_loan_schemes', 'calculate_quote', 'submit_application']);
    expect(body.tools[2].function.parameters.properties.karat.enum).toEqual([18, 22, 24]);
    expect(body.messages[2].tool_calls[0]).toEqual({ id: 'x', type: 'function', function: { name: 'get_loan_schemes', arguments: '{}' } });
  });

  it('echoes provider extra_content (Gemini 3 thought_signature) back on the next turn', async () => {
    const sig = { google: { thought_signature: 'SIG123' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(200, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', extra_content: sig, function: { name: 'get_loan_schemes', arguments: '{}' } }] } }] }),
      )
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await provider().chat([{ role: 'user', content: 'hi' }], TOOL_DEFS);
    expect(first.toolCalls[0].extra).toEqual(sig);
    await provider().chat(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: first.toolCalls },
        { role: 'tool', tool_call_id: 'c1', name: 'get_loan_schemes', content: '{"data":[]}' },
      ],
      TOOL_DEFS,
    );
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.messages[1].tool_calls[0].extra_content).toEqual(sig);
  });

  it('returns plain text replies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { choices: [{ message: { content: 'Hello' } }] })));
    expect(await provider().chat([{ role: 'user', content: 'hi' }], TOOL_DEFS)).toEqual({ content: 'Hello', toolCalls: [] });
  });

  it('retries a 429 and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { error: 'rate' }))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await provider().chat([{ role: 'user', content: 'hi' }], TOOL_DEFS);
    expect(out.content).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('persistent 429 becomes a friendly 503 LLM_BUSY, never a crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(reply(429, {}))));
    await expect(provider().chat([{ role: 'user', content: 'hi' }], TOOL_DEFS)).rejects.toMatchObject({
      status: 503,
      code: 'LLM_BUSY',
      message: expect.stringContaining('busy'),
    });
  });

  it('a 4xx (bad key) is a 502 and does not leak the provider response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401, { error: { message: 'API key invalid: KEY-SECRET' } })));
    const err: any = await provider().chat([{ role: 'user', content: 'hi' }], TOOL_DEFS).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain('KEY-SECRET');
  });

  it('a network failure is a friendly 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(provider().chat([{ role: 'user', content: 'hi' }], TOOL_DEFS)).rejects.toMatchObject({ status: 503, code: 'LLM_UNAVAILABLE' });
  });
});
