// ─────────────────────────────────────────────────────────────
// Agregador: recebe relatórios dos exportadores (EA do MT5, AddOn do NinjaTrader),
// junta tudo e grava public/status.json, que o escritório lê com ?live=1.
//
//   POST /report       corpo JSON (veja integrations/README.md)
//   GET  /status.json  o mesmo arquivo, com CORS liberado
//   GET  /health
//
// Sem dependências. Variáveis de ambiente:
//   PORT (8787) · HOST (127.0.0.1) · ROBOT_OFFICE_TOKEN (opcional, header X-Token) · STATUS_FILE
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROBOTS } from '../src/data/robots.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.ROBOT_OFFICE_TOKEN || '';
const OUT = process.env.STATUS_FILE || path.join(here, '..', 'public', 'status.json');
const MAX_BODY = 1_000_000;
const MAX_TRADES = 12;
const MAX_EVENTS = 60;

const known = new Set(ROBOTS.map((r) => r.id));
const robots = new Map(); // id -> estado
const events = [];
let updatedAt = null;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : d);
const money = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

// aceita segundos, milissegundos ou ISO
function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? Date.now() : t;
}

function loadExisting() {
  try {
    const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const r of data.robots || []) {
      if (!known.has(r.id)) continue;
      robots.set(r.id, {
        id: r.id, status: r.status === 'operating' ? 'operating' : 'rest', setup: str(r.setup, '—'), symbol: str(r.symbol, '—'),
        side: r.side === 'SELL' ? 'SELL' : 'BUY', openPnl: num(r.openPnl), closedPnl: num(r.closedPnl), balance: num(r.balance),
        trades: (r.trades || []).map((t) => ({ ts: toMs(t.time), symbol: str(t.symbol, '—'), side: t.side === 'SELL' ? 'SELL' : 'BUY', setup: str(t.setup), pnl: num(t.pnl) })),
      });
    }
    for (const e of data.events || []) events.push({ ts: toMs(e.time), robotId: e.robotId, text: String(e.text) });
    updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    console.log(`[aggregator] retomou ${robots.size} robôs de ${OUT}`);
  } catch { /* primeira execução */ }
}

const pushEvent = (robotId, text) => { events.push({ ts: Date.now(), robotId, text }); if (events.length > MAX_EVENTS) events.shift(); };

function merge(body) {
  const unknown = [];
  let accepted = 0;
  for (const r of Array.isArray(body.robots) ? body.robots : []) {
    const id = typeof r?.id === 'string' ? r.id : '';
    if (!known.has(id)) { if (id) unknown.push(id); continue; }
    const prev = robots.get(id);
    const status = r.status === 'operating' ? 'operating' : 'rest';
    const next = {
      id, status,
      setup: str(r.setup, prev?.setup || '—'), symbol: str(r.symbol, prev?.symbol || '—'),
      side: r.side === 'SELL' ? 'SELL' : r.side === 'BUY' ? 'BUY' : prev?.side || 'BUY',
      openPnl: status === 'operating' ? num(r.openPnl) : 0,
      closedPnl: num(r.closedPnl), balance: num(r.balance),
      trades: prev ? [...prev.trades] : [],
    };
    // operações novas (deduplicadas) viram evento "Fechou ..."
    const seen = new Set(next.trades.map((t) => `${t.ts}|${t.symbol}|${t.pnl}`));
    const fresh = [];
    for (const t of Array.isArray(r.trades) ? r.trades : []) {
      const rec = { ts: toMs(t.ts ?? t.time), symbol: str(t.symbol, '—'), side: t.side === 'SELL' ? 'SELL' : 'BUY', setup: str(t.setup), pnl: num(t.pnl) };
      const key = `${rec.ts}|${rec.symbol}|${rec.pnl}`;
      if (!seen.has(key)) { seen.add(key); fresh.push(rec); }
    }
    fresh.sort((a, b) => a.ts - b.ts);
    next.trades = [...next.trades, ...fresh].sort((a, b) => a.ts - b.ts).slice(-MAX_TRADES);
    if (prev) for (const t of fresh) pushEvent(id, `Fechou ${t.symbol} ${t.side} · ${money(t.pnl)}`);
    if (prev && prev.status !== next.status) {
      pushEvent(id, next.status === 'operating' ? `Voltou a operar · ${next.symbol} ${next.side} · ${next.setup}` : 'Foi para o descanso');
    }
    robots.set(id, next);
    accepted++;
  }
  for (const e of Array.isArray(body.events) ? body.events : []) {
    if (known.has(e?.robotId) && e.text) pushEvent(e.robotId, String(e.text).slice(0, 200));
  }
  if (accepted) updatedAt = new Date();
  return { accepted, unknown };
}

function snapshot() {
  return {
    updatedAt: (updatedAt || new Date()).toISOString(),
    robots: [...robots.values()].map((r) => ({ ...r, trades: r.trades.map((t) => ({ time: new Date(t.ts).toISOString(), symbol: t.symbol, side: t.side, setup: t.setup, pnl: t.pnl })) })),
    events: events.map((e) => ({ time: new Date(e.ts).toISOString(), robotId: e.robotId, text: e.text })),
  };
}

let writeTimer = null;
function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const json = JSON.stringify(snapshot(), null, 2);
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const tmp = `${OUT}.tmp`;
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, OUT);
    } catch (err) {
      try { fs.writeFileSync(OUT, json); } catch (e2) { console.error('[aggregator] falha ao gravar', OUT, e2.message); }
    }
  }, 300);
}

const tokenOk = (req) => {
  if (!TOKEN) return true;
  const got = Buffer.from(String(req.headers['x-token'] || ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end(JSON.stringify(obj));
  };
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return send(204, {});
  if (req.method === 'GET' && url === '/health') return send(200, { ok: true, robots: robots.size });
  if (req.method === 'GET' && url === '/status.json') return send(200, snapshot());
  if (req.method === 'POST' && url === '/report') {
    if (!tokenOk(req)) return send(401, { error: 'token inválido' });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(413, { error: 'corpo grande demais' }); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'JSON inválido' }); }
      const result = merge(body);
      if (result.unknown.length) console.warn(`[aggregator] ids desconhecidos (confira src/data/robots.js): ${result.unknown.join(', ')}`);
      if (result.accepted) scheduleWrite();
      send(200, result);
    });
    return;
  }
  send(404, { error: 'não encontrado' });
});

loadExisting();
server.listen(PORT, HOST, () => {
  console.log(`[aggregator] ouvindo em http://${HOST}:${PORT}  →  grava ${OUT}`);
  if (!TOKEN) console.log('[aggregator] sem token (aceita qualquer relatório local). Defina ROBOT_OFFICE_TOKEN se expuser a porta.');
});
