// ─────────────────────────────────────────────────────────────
// Feed ao vivo: lê o estado do motor (GET ./status.json) e manda as ações do dono para ele
// (POST /api/…). Expõe a mesma interface do feed simulado (feed.js).
//
// Quem escreve o estado é o motor (npm run motor, pasta motor/). O formato é o de motor/state.mjs:
// { motor: true, updatedAt, paused, pauseReason, budget, spend: { today, series }, deliveredTotal,
//   robots: { WEB_01: { status, activity, taskId, progress, done, commits, cost, paused } },
//   board: [task], reports, ideas, releases, changelog, incidents, insights, alerts, audit,
//   events: [{ time, robotId, text }], meeting, canvas }
// Cada task tem id, title, area ('web' | 'app'), column, dev, qa, secBy, branch, commits, tests,
// rework, findings, origin, cost, timeline, released. Datas vêm em ISO.
//
// Sem o motor no ar (só um status.json estático), o escritório mostra, mas não decide nada.
// ─────────────────────────────────────────────────────────────
import { ROBOTS } from './robots.js';

const blank = () => ({ status: 'idle', activity: 'Livre', taskId: null, progress: 0, done: 0, commits: 0, cost: 0, paused: false });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const date = (v) => { const d = new Date(v); return isNaN(d) ? new Date() : d; };
const list = (v) => (Array.isArray(v) ? v : []);
const withTs = (items, key = 'time') => list(items).map((x) => ({ ...x, ts: date(x[key] ?? x.ts) }));

export function createLiveFeed({ url = './status.json', intervalMs = 3000 } = {}) {
  const listeners = new Set();
  const state = new Map(ROBOTS.map((r) => [r.id, blank()]));
  // listas que a interface guarda por referência: troca o conteúdo, nunca o array
  const lists = { history: [], audit: [], alerts: [], board: [], reports: [], ideas: [], delivered: [], releases: [], changelog: [], incidents: [], insights: [] };
  const spend = { today: 0, series: [] };
  let timer = null;
  let lastStamp = null;
  const fill = (key, items) => lists[key].splice(0, lists[key].length, ...items);

  async function post(path, body) {
    const res = await fetch(`./api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    poll();
    return out;
  }
  const act = (path, body) => post(path, body).catch((err) => { api.error = err.message; listeners.forEach((fn) => fn({ type: 'error', error: err.message })); });

  const api = {
    ...lists,
    spend,
    canvas: null,
    meeting: null,
    paused: false,
    pauseReason: null,
    budget: 0,
    updatedAt: null,
    error: null,
    canDecide: false, // só com o motor no ar
    getState: (id) => state.get(id),
    task: (id) => lists.board.find((t) => t.id === id),
    approveIdea: (id) => act('decide', { id, approved: true }),
    rejectIdea: (id) => act('decide', { id, approved: false }),
    setPaused: (paused) => act('pause', { paused }),
    setRobotPaused: (id, paused) => act('robot-pause', { id, paused }),
    setBudget: (usd) => act('budget', { usd }),
    prioritize: (taskId, beforeId) => act('prioritize', { taskId, beforeId }),
    ask: async (robotId, text) => (await post('ask', { robotId, text })).answer,
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
    api.updatedAt = data.updatedAt ? date(data.updatedAt) : new Date();
    api.canDecide = data.motor === true;
    api.paused = !!data.paused;
    api.pauseReason = data.pauseReason || null;
    api.budget = num(data.budget);
    api.meeting = data.meeting || null;
    Object.assign(spend, { today: num(data.spend?.today), series: list(data.spend?.series).map(num) });

    // robôs: aceita o objeto do motor ({ WEB_01: {...} }) ou a lista antiga ([{ id, ... }])
    const robots = Array.isArray(data.robots) ? data.robots : Object.entries(data.robots || {}).map(([id, r]) => ({ id, ...r }));
    for (const r of robots) {
      const s = state.get(r?.id);
      if (!s) continue;
      Object.assign(s, {
        status: ['working', 'meeting'].includes(r.status) ? r.status : 'idle',
        activity: r.activity || (r.status === 'working' ? 'Trabalhando' : 'Livre'),
        taskId: r.taskId || null,
        progress: Math.min(1, Math.max(0, num(r.progress))),
        done: num(r.done), commits: num(r.commits), cost: num(r.cost), paused: !!r.paused,
      });
    }
    fill('board', list(data.board).filter((t) => t?.id).map((t) => ({
      ...t,
      area: t.area === 'app' ? 'app' : 'web',
      commits: withTs(t.commits),
      findings: list(t.findings).map((f) => ({ severity: 'média', ...f, open: f.open !== false })),
      timeline: list(t.timeline),
      rework: num(t.rework),
      cost: num(t.cost),
      createdAt: date(t.createdAt),
      mergedAt: t.mergedAt ? date(t.mergedAt) : null,
    })));
    fill('reports', withTs(data.reports).slice(-60));
    fill('ideas', withTs(data.ideas).map((i) => ({ ...i, status: i.status || 'aguardando' })).slice(-60));
    fill('releases', withTs(data.releases));
    fill('changelog', withTs(data.changelog));
    fill('incidents', withTs(data.incidents));
    fill('insights', withTs(data.insights));
    fill('alerts', withTs(data.alerts));
    fill('audit', withTs(data.audit).slice(-3000));
    const total = Number.isFinite(data.deliveredTotal) ? data.deliveredTotal : lists.reports.length;
    if (lists.delivered.at(-1) !== total || !lists.delivered.length) lists.delivered.push(total);
    if (lists.delivered.length > 120) lists.delivered.shift();
    if (data.canvas) {
      const c = data.canvas;
      api.canvas = {
        title: c.title || 'Canvas', url: c.url || '', version: c.version || null, syncedAt: date(c.syncedAt),
        screens: list(c.screens).filter((sc) => sc?.file).map((sc) => ({
          ...sc, name: sc.name || String(sc.title || sc.file).replace(/^\d+ · /, ''),
          status: sc.status || 'planejada', outdated: !!sc.outdated, phaseName: sc.phaseName || '', section: sc.section || '',
        })),
        changes: withTs(c.changes).slice(-40),
      };
    }
    fill('history', list(data.events)
      .filter((e) => e && state.has(e.robotId) && e.text)
      .map((e) => ({ ts: date(e.time), robotId: e.robotId, message: String(e.text) }))
      .sort((a, b) => a.ts - b.ts)
      .slice(-120));
  }

  return api;
}
