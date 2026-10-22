// Servidor local do motor: liga o orquestrador e expõe o estado e as ações para o escritório.
//   npm run motor              usa motor/config.json
//   npm run motor -- --dry-run ensaio: sem chamar a API, sem git e sem GitHub
// O Vite repassa /status.json e /api/* para cá (vite.config.js); abra o escritório com ?live=1.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOrchestrator } from './orchestrator.mjs';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const file = existsSync(here('./config.json')) ? here('./config.json') : here('./config.example.json');
const config = JSON.parse(readFileSync(file, 'utf8'));
if (process.argv.includes('--dry-run') || file.endsWith('config.example.json')) config.dryRun = true;
if (!config.dryRun) {
  for (const [area, repo] of Object.entries(config.repos)) {
    if (!existsSync(repo.path)) throw new Error(`Repositório ${area} não encontrado em ${repo.path} (motor/config.json)`);
  }
}

const motor = createOrchestrator(config);
const { actions } = motor;

const ROUTES = {
  'POST /api/decide': ({ id, approved }) => actions.decide(id, !!approved),
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
  console.log('Abra o escritório com ?live=1 (npm run dev em outro terminal).');
  motor.start();
});
