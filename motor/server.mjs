// Servidor local do motor: liga o orquestrador e expõe o estado e as ações para o escritório.
//   npm run motor              usa motor/config.json
//   npm run motor -- --dry-run ensaio: sem chamar a API, sem git e sem GitHub
// O Vite repassa /status.json e /api/* para cá (vite.config.js); abra o escritório com ?live=1.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOrchestrator } from './orchestrator.mjs';
import { GIT_BASH } from './agents.mjs';
import { createAccount } from './account.mjs';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
// Conta dos robôs, em ordem: ANTHROPIC_API_KEY ou CLAUDE_CODE_OAUTH_TOKEN em motor/.env (fora do git); senão a
// conta conectada pelo botão "Conectar conta Claude" (account.mjs); senão o login do Claude Code desta máquina.
if (existsSync(here('./.env'))) process.loadEnvFile(here('./.env'));
for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) if (!process.env[k]) delete process.env[k];
const file = existsSync(here('./config.json')) ? here('./config.json') : here('./config.example.json');
const config = JSON.parse(readFileSync(file, 'utf8'));
if (process.argv.includes('--dry-run') || file.endsWith('config.example.json')) config.dryRun = true;
// MOTOR_PORT roda um segundo motor (um ensaio, por exemplo) ao lado do de verdade
if (process.env.MOTOR_PORT) config.port = Number(process.env.MOTOR_PORT);
if (!config.dryRun) {
  for (const [area, repo] of Object.entries(config.repos)) {
    if (!existsSync(repo.path)) throw new Error(`Repositório ${area} não encontrado em ${repo.path} (motor/config.json)`);
  }
}

const motor = createOrchestrator(config);
const { actions } = motor;
// conta Claude dos robôs (botão "Conectar conta Claude" no escritório)
const account = createAccount({ log: (text) => motor.state.push('OPS_01', text) });

const ROUTES = {
  // a conta Claude e a IA escolhida (Claude ou OpenCode) com os modelos de cada uma
  'GET /api/account': async () => ({ ...(await account.status()), ai: await actions.aiInfo() }),
  'POST /api/ai': ({ provider, model, refresh }) => (refresh ? actions.aiInfo({ refresh: true }) : actions.setAi({ provider, model })),
  'POST /api/account/login': async ({ email }) => { account.startLogin(String(email || '').trim()); return account.status(); },
  'POST /api/account/code': async ({ code }) => { account.submitCode(code); return account.status(); },
  'POST /api/account/logout': async () => { await account.logout(); return account.status(); },
  'POST /api/decide': ({ id, approved }) => actions.decide(id, !!approved),
  'POST /api/unblock': ({ taskId }) => ({ ok: actions.unblock(String(taskId || '')) }),
  'POST /api/pause': ({ paused }) => actions.setPaused(!!paused),
  'POST /api/robot-pause': ({ id, paused }) => actions.setRobotPaused(id, !!paused),
  'POST /api/budget': ({ usd }) => actions.setBudget(Number(usd)),
  'POST /api/adjust': ({ id, note }) => actions.adjustIdea(id, String(note || '').slice(0, 500)),
  'POST /api/prioritize': ({ taskId, beforeId }) => actions.prioritize(taskId, beforeId || null),
  'POST /api/ask': async ({ robotId, text }) => ({ answer: await actions.ask(robotId, String(text || '').slice(0, 2000)) }),
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); } });
  req.on('error', reject);
});
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/status.json') return send(res, 200, motor.state.data);
  const route = ROUTES[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'não existe' });
  try {
    const out = await route(await readBody(req));
    send(res, 200, out ?? { ok: true });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

// só na máquina do dono: o servidor aprova releases e mexe em repositórios
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Motor do escritório em http://127.0.0.1:${config.port} · ${config.dryRun ? 'ENSAIO (dry-run)' : 'valendo'} · ${file.split(/[\\/]/).pop()}`);
  account.status().then((st) => console.log(`Conta Claude dos robôs: ${st.label}`));
  if (process.platform === 'win32') console.log(GIT_BASH ? `Terminal dos agentes Claude: Git Bash (${GIT_BASH})` : 'Atenção: Git Bash não encontrado; os agentes Claude ficam sem terminal (defina CLAUDE_CODE_GIT_BASH_PATH no motor/.env)');
  console.log('Abra o escritório com ?live=1 (npm run dev em outro terminal).');
  motor.start();
});
