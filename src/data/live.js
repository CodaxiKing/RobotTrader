// ─────────────────────────────────────────────────────────────
// Feed ao vivo: consulta ./status.json e expõe a mesma interface do feed simulado.
//
// Formato do status.json (veja public/status.example.json):
// { "updatedAt": ISO,
//   "robots": [{ "id": "PA_01", "status": "operating" | "rest", "setup": "SETUP 3.1",
//                "symbol": "EURUSD", "side": "BUY", "openPnl": 12.3, "closedPnl": 45.6,
//                "balance": 10000, "trades": [{ "time": ISO, "symbol": "...", "side": "...", "pnl": 1.2 }] }],
//   "events": [{ "time": ISO, "robotId": "PA_01", "text": "..." }] }
//
// Quem escreve esse arquivo é o seu EA do MT5 / estratégia do NinjaTrader (ou um script
// que consolida os dois). A curva de equity é montada aqui, a cada atualização.
// ─────────────────────────────────────────────────────────────
import { ROBOTS } from './robots.js';

const blank = () => ({ status: 'rest', setup: '—', symbol: '—', side: 'BUY', openPnl: 0, closedPnl: 0, balance: 0, equity: [], trades: [] });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function createLiveFeed({ url = './status.json', intervalMs = 5000 } = {}) {
  const listeners = new Set();
  const history = [];
  const state = new Map(ROBOTS.map((r) => [r.id, blank()]));
  let timer = null;
  let lastStamp = null;

  const api = {
    history,
    updatedAt: null,
    error: null,
    getState: (id) => state.get(id),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, intervalMs);
    },
    stop() { clearInterval(timer); timer = null; },
  };

  async function poll() {
    try {
      const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      api.error = null;
      if (data.updatedAt && data.updatedAt === lastStamp) return listeners.forEach((fn) => fn({ type: 'heartbeat' }));
      lastStamp = data.updatedAt;
      apply(data);
      listeners.forEach((fn) => fn({ type: 'sync' }));
    } catch (err) {
      api.error = String(err.message || err);
      listeners.forEach((fn) => fn({ type: 'error', error: api.error }));
    }
  }

  function apply(data) {
    const ts = data.updatedAt ? new Date(data.updatedAt) : new Date();
    api.updatedAt = isNaN(ts) ? new Date() : ts;
    for (const r of Array.isArray(data.robots) ? data.robots : []) {
      const s = state.get(r?.id);
      if (!s) continue;
      s.status = r.status === 'operating' ? 'operating' : 'rest';
      s.setup = r.setup || s.setup;
      s.symbol = r.symbol || s.symbol;
      s.side = r.side === 'SELL' ? 'SELL' : 'BUY';
      s.openPnl = s.status === 'operating' ? num(r.openPnl) : 0;
      s.closedPnl = num(r.closedPnl);
      s.balance = num(r.balance);
      if (Array.isArray(r.trades)) {
        s.trades = r.trades.slice(-12).map((t) => ({ ts: new Date(t.time), symbol: t.symbol || s.symbol, side: t.side || 'BUY', setup: t.setup || '', pnl: num(t.pnl), open: false }));
      }
      s.equity.push(Math.round((s.closedPnl + s.openPnl) * 100) / 100);
      if (s.equity.length > 80) s.equity.shift();
    }
    const evts = (Array.isArray(data.events) ? data.events : [])
      .filter((e) => e && state.has(e.robotId) && e.text)
      .map((e) => ({ ts: new Date(e.time), robotId: e.robotId, message: String(e.text) }))
      .filter((e) => !isNaN(e.ts))
      .sort((a, b) => a.ts - b.ts)
      .slice(-60);
    history.splice(0, history.length, ...evts);
  }

  return api;
}
