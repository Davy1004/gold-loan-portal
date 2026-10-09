import { config } from '../config.js';
import { mockProvider } from './mock.js';
import { openAiCompatible } from './openai.js';
import type { LlmProvider } from './types.js';

export function createProvider(name = config.llmProvider): LlmProvider {
  switch (name) {
    case 'mock':
      return mockProvider();
    case 'gemini':
      if (!config.gemini.apiKey) {
        throw new Error('LLM_PROVIDER=gemini needs GEMINI_API_KEY in .env (free key: https://aistudio.google.com/apikey)');
      }
      return openAiCompatible({ name: `gemini:${config.gemini.model}`, baseUrl: config.gemini.baseUrl, model: config.gemini.model, apiKey: config.gemini.apiKey });
    case 'ollama':
      return openAiCompatible({ name: `ollama:${config.ollama.model}`, baseUrl: config.ollama.baseUrl, model: config.ollama.model });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}". Use mock, gemini or ollama.`);
  }
}
