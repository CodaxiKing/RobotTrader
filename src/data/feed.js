// ─────────────────────────────────────────────────────────────
// Fonte de dados simulada. A interface é a mesma do feed ao vivo (live.js):
//   feed.getState(id) -> estado do robô
//   feed.history      -> eventos recentes (o mais novo por último)
//   feed.subscribe(fn), feed.start(), feed.stop(), feed.updatedAt
//
// Estado de um robô:
//   { status: 'operating' | 'rest', setup, symbol, side: 'BUY' | 'SELL',
//     openPnl, closedPnl, balance, equity: number[], trades: [{ ts, symbol, side, setup, pnl, open }] }
// ─────────────────────────────────────────────────────────────
import { ROBOTS, FLOORS, SETUPS } from './robots.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const randn = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
const round2 = (n) => Math.round(n * 100) / 100;

export function createSimulatedFeed({ intervalMs = 1400, historySize = 60 } = {}) {
  const listeners = new Set();
  const history = [];
  const state = new Map();
  let timer = null;

  const floorOf = (r) => FLOORS.find((f) => f.id === r.floor);

  function newTrade(r, s) {
    s.setup = pick(SETUPS);
    s.symbol = pick(r.symbols);
    s.side = Math.random() < 0.5 ? 'BUY' : 'SELL';
    s.openPnl = 0;
  }

  const now = Date.now();
  ROBOTS.forEach((r, i) => {
    const operating = Math.random() < 0.62;
    const s = {
      status: operating ? 'operating' : 'rest',
      setup: pick(SETUPS), symbol: pick(r.symbols), side: Math.random() < 0.5 ? 'BUY' : 'SELL',
      openPnl: operating ? round2(randn() * 120 + 40) : 0,
      closedPnl: round2(randn() * 90 + 40),
      balance: 10000 + Math.round(Math.random() * 40000),
      equity: [], trades: [],
    };
    let v = s.closedPnl - 80;
    for (let k = 0; k < 50; k++) { v += randn() * 9 + 1.5; s.equity.push(round2(v)); }
    s.equity[s.equity.length - 1] = round2(s.closedPnl + s.openPnl);
    const n = 3 + (i % 4);
    for (let k = 0; k < n; k++) {
      s.trades.push({ ts: new Date(now - (n - k) * 340_000), symbol: pick(r.symbols), side: Math.random() < 0.5 ? 'BUY' : 'SELL', setup: pick(SETUPS), pnl: round2(randn() * 60 + 10), open: false });
    }
    state.set(r.id, s);
  });

  const push = (evt) => {
    history.push(evt);
    if (history.length > historySize) history.shift();
    listeners.forEach((fn) => fn(evt));
  };

  function tick() {
    const changed = [];
    for (const r of ROBOTS) {
      const s = state.get(r.id);
      if (s.status === 'operating') {
        s.openPnl = round2(s.openPnl + randn() * 9 + 0.6);
        const roll = Math.random();
        if (roll < 0.035) { // fecha a operação
          const pnl = s.openPnl;
          s.closedPnl = round2(s.closedPnl + pnl);
          s.trades.push({ ts: new Date(), symbol: s.symbol, side: s.side, setup: s.setup, pnl, open: false });
          if (s.trades.length > 12) s.trades.shift();
          push({ ts: new Date(), robotId: r.id, message: `Fechou ${s.symbol} ${s.side} · ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` });
          newTrade(r, s);
          if (Math.random() < 0.35) { s.status = 'rest'; s.openPnl = 0; push({ ts: new Date(), robotId: r.id, message: 'Foi para o descanso' }); }
          else push({ ts: new Date(), robotId: r.id, message: `Abriu ${s.symbol} ${s.side} · ${s.setup}` });
        }
      } else if (Math.random() < 0.03) {
        s.status = 'operating';
        newTrade(r, s);
        push({ ts: new Date(), robotId: r.id, message: `Voltou a operar · ${s.symbol} ${s.side} · ${s.setup}` });
      }
      s.equity.push(round2(s.closedPnl + s.openPnl));
      if (s.equity.length > 80) s.equity.shift();
      changed.push(r.id);
    }
    api.updatedAt = new Date();
    listeners.forEach((fn) => fn({ type: 'sync', ids: changed }));
  }

  const api = {
    history,
    updatedAt: new Date(),
    error: null,
    getState: (id) => state.get(id),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() { if (!timer) timer = setInterval(tick, intervalMs); },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}
