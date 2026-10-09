# Architecture

```
React (Vite)                         Express 5 API (TypeScript, Zod)                Database
┌────────────────────┐   /api/v1     ┌──────────────────────────────────────┐      ┌────────────────────┐
│ 3-step apply flow  │──────────────▶│ routes  (validate with Zod -> 400)   │      │ PostgreSQL         │
│ admin table        │               │   │                                  │      │  (pg)  or PGlite   │
│ Loan Assist chat   │──┐            │   ▼                                  │      │  same SQL, same    │
└────────────────────┘  │            │ services  quotes.ts  leads.ts  <─────┼──────│  migrations        │
                        │            │   ▲   (the only code that does money │      └────────────────────┘
                        │            │   │    maths or writes a lead)       │
                        └───────────▶│ agent router ──▶ AgentService        │──▶ LlmProvider
                          /agent/*   │   tools = same schemas + same        │     mock | gemini | ollama
                                     │   services as the REST API           │
                                     └──────────────────────────────────────┘
```

## Decisions

**One service layer, two front doors.** `services/quotes.ts` and `services/leads.ts` are the only code that
computes money or inserts a lead. `POST /leads` and the agent's confirmed submission both call `createLead`, so a lead filed by the
agent is identical to a form lead (there is a test that compares them field by field).

**Money is exact.** `domain/money.ts` uses BigInt: weights in milligrams, the 24K rate in paise/gram, LTV in basis points.
The loan is `floor(net * karat * rate * ltv / constants)` in a single integer division from the exact rational, so rounding
can never push a loan up, and there is no float anywhere. Gold value is stored as integer paise, loans as integer rupees.
LTV is capped at 75% in code *and* by a database CHECK constraint.

**The server never trusts numbers.** Zod strips unknown keys, so a client-sent `eligibleLoanRupees` is discarded;
`createLead` recomputes everything from net weight, karat and the plan row.

**Duplicates are race-free.** `createLead` runs in a transaction that first takes `pg_advisory_xact_lock(hashtext('mobile:…'))`,
then checks for an application from that mobile in the last 7 days. Two simultaneous requests serialise on the lock: exactly one
201, the rest 409. An `Idempotency-Key` header (same lock pattern, stored response) makes retries replay the original 201.
The concurrency tests only prove something on a real server, because PGlite runs one query at a time, so CI runs them
against PostgreSQL, and removing the lock makes them fail.

**Embedded Postgres by default.** `DATABASE_URL` set means the `pg` driver against a real server (docker-compose.yml provided).
Unset means PGlite (the real Postgres engine compiled to WASM) so `npm install && npm run dev` works with no database to install.
Prisma was deliberately skipped: plain SQL migrations run identically on both engines and keep the money columns explicit.

**Error contract.** Every error is `{ error: { code, message, fields: [{field, message}], details? } }`; a single Express error
handler maps `AppError`, Zod errors, malformed JSON and unknown errors (500, no stack trace, generic message).

## The agent

* `AgentService` runs the loop: provider call, execute tool calls, feed results back, repeat (max 8 steps), then reply.
* **Tools** are defined once; their JSON Schemas are generated from the same Zod schemas the API uses, and arguments are validated
  with those schemas. A failed validation goes back to the model as a tool result so it can ask the user to fix the value.
  Malformed JSON arguments are handled the same way (and numeric strings like `"45"` are coerced).
* **No arithmetic by the model.** The prompt forbids it, `calculate_quote` returns every figure (including EMI), and the eval
  harness asserts (in the happy-path and change-of-mind conversations) that every number in an assistant reply already appears in the
  user's messages or a tool result.
* **Confirmation is code, not a prompt.** `submit_application` only *prepares*: it validates, checks the 7-day rule, builds a summary with
  server-computed numbers and stores a single-use token. Nothing is written until the browser calls `POST /agent/confirm` with that token
  (the Confirm button). A model that tries to submit on its own, or a prompt-injected one, ends up with a summary card and zero leads.
  Tests use a deliberately over-eager scripted model to prove it.
* **Privacy.** Mobile numbers are masked in logs (`logger.ts` masks any 10-digit number) and in every response; the summary card shows
  the masked number; the browser never holds an LLM key.

## Known limits

Agent sessions live in server memory (single instance; lost on restart). The admin view has no authentication. There is no rate limit
on `/leads`. Status workflow / audit log is not built (status is always SUBMITTED).
