/**
 * npm run eval - runs the test conversations end to end through the real agent loop, tool layer,
 * validation and database (fresh in-memory DB per conversation). Asserts on OUTCOMES (tool calls, database rows,
 * numbers in replies), not exact wording, so it works with the mock and with a live model (LLM_PROVIDER=gemini).
 */
import { AgentService } from '../src/agent/agent.js';
import { createProvider } from '../src/agent/providers.js';
import { bootDb } from '../src/db/boot.js';
import { Harness, scenarios } from './scenarios.js';

process.env.LOG_LEVEL = 'silent';
const provider = createProvider();
console.log(`\nLoan Assist evals - provider: ${provider.name}\n`);

let failedRequired = 0;
let failedBonus = 0;
let totalChecks = 0;
let passedChecks = 0;

for (const sc of scenarios) {
  const db = await bootDb({ inMemory: true });
  const h = new Harness(new AgentService(db, provider), db);
  let checks;
  try {
    checks = await sc.run(h);
  } catch (e) {
    checks = [{ name: 'scenario ran without throwing', pass: false, detail: e instanceof Error ? e.message : String(e) }];
  }
  await db.close();
  const pass = checks.every((c) => c.pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  #${sc.id} ${sc.title}${sc.required ? '' : '  (bonus)'}`);
  for (const c of checks) {
    totalChecks++;
    if (c.pass) passedChecks++;
    console.log(`        ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass ? '' : `\n             -> ${c.detail ?? ''}`}`);
  }
  if (!pass) sc.required ? failedRequired++ : failedBonus++;
}

console.log(`\n${passedChecks}/${totalChecks} checks passed. Required conversations failing: ${failedRequired}. Bonus failing: ${failedBonus}.\n`);
process.exit(failedRequired + failedBonus ? 1 : 0);
