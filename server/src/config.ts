import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One .env at the repo root (server/.env also works). Real environment variables always win.
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [join(here, '..', '..', '.env'), join(here, '..', '.env')], quiet: true });

/** 24K gold rate used for every calculation. Mock value from the brief. */
export const RATE_24K_RUPEES_PER_GRAM = Number(process.env.RATE_24K_PER_GRAM ?? 7000);
export const MAX_LTV_BPS = 7500; // never above 75%
export const DUPLICATE_WINDOW_DAYS = 7;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL || undefined,
  pgliteDir: process.env.PGLITE_DIR ?? '.data/pglite',
  llmProvider: (process.env.LLM_PROVIDER ?? 'mock').toLowerCase(),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    baseUrl:
      process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  ollama: {
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
  },
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};
