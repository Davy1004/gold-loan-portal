import { AgentService } from './agent/agent.js';
import { createProvider } from './agent/providers.js';
import { agentRouter } from './agent/router.js';
import { config } from './config.js';
import { bootDb } from './db/boot.js';
import { createApp } from './http/app.js';

const db = await bootDb();
const agent = new AgentService(db, createProvider());
const app = createApp({ db, extraRouters: [agentRouter(agent)] });

app.listen(config.port, () => {
  console.log(`API on http://localhost:${config.port}  (db: ${db.kind}, llm: ${agent.providerName})`);
});
