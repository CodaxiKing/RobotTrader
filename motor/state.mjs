// Estado do motor, no mesmo formato que o escritório lê com ?live=1 (src/data/live.js).
// Fica em memória e é salvo em motor/state.json a cada mudança, para sobreviver a um reinício.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROBOTS } from '../src/data/robots.js';

const FILE = fileURLToPath(new URL('./state.json', import.meta.url));
const dayKey = () => new Date().toISOString().slice(0, 10);
const keep = (list, max) => { if (list.length > max) list.splice(0, list.length - max); };
const now = () => new Date().toISOString();

export function createState({ budget }) {
  const fresh = {
    motor: true,
    updatedAt: now(),
    paused: false,
    pauseReason: null,
    budget,
    spend: { day: dayKey(), today: 0, series: [] },
    deliveredTotal: 0,
    robots: Object.fromEntries(ROBOTS.map((r) => [r.id, { status: 'idle', activity: 'Livre', taskId: null, progress: 0, done: 0, commits: 0, cost: 0, paused: false }])),
    board: [], reports: [], ideas: [], releases: [], changelog: [], incidents: [], insights: [],
    marketing: { pieces: [], promotions: [] },
    alerts: [], audit: [], events: [], meeting: null, canvas: null,
    seq: { idea: 0, alert: 0 },
  };
  let s = fresh;
  if (existsSync(FILE)) {
    try {
      s = { ...fresh, ...JSON.parse(readFileSync(FILE, 'utf8')) };
      // ninguém está trabalhando de verdade logo depois de um reinício
      // robôs novos na equipe entram zerados; os que já existiam guardam a contagem e o gasto
      s.robots = Object.fromEntries(Object.keys(fresh.robots).map((id) => [id, { ...fresh.robots[id], ...(s.robots?.[id] || {}), status: 'idle', activity: 'Livre', taskId: null, progress: 0 }]));
      s.meeting = null;
    } catch (err) {
      console.warn(`motor/state.json ilegível (${err.message}); começando do zero`);
    }
  }
  s.budget = s.budget || budget;

  const listeners = new Set();
  let saveTimer = null;
  let saveFailed = false;
  function changed() {
    s.updatedAt = now();
    listeners.forEach((fn) => fn(s));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // sem conseguir salvar (disco cheio, arquivo preso) o motor avisa e segue; o próximo save tenta de novo
      try {
        writeFileSync(`${FILE}.tmp`, JSON.stringify(s));
        renameSync(`${FILE}.tmp`, FILE);
        saveFailed = false;
      } catch (err) {
        if (!saveFailed) console.error(`Não consegui salvar motor/state.json: ${err.code || err.message}`);
        saveFailed = true;
      }
    }, 300);
  }

  const api = {
    get data() { return s; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    changed,
    robot: (id) => s.robots[id],
    task: (id) => s.board.find((t) => t.id === id),
    // tudo o que acontece vai para os eventos recentes e para o histórico completo
    push(robotId, text, { taskId = null, kind = 'evento' } = {}) {
      s.events.push({ time: now(), robotId, text });
      keep(s.events, 120);
      s.audit.push({ time: now(), actor: robotId, kind, text, taskId });
      keep(s.audit, 5000);
      console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${robotId}: ${text}`);
      changed();
    },
    decision(text, taskId = null) {
      s.audit.push({ time: now(), actor: 'VOCÊ', kind: 'decisão', text, taskId });
      changed();
    },
    step(task, robotId, text) {
      task.timeline.push({ ts: now(), robotId, text });
      api.push(robotId, text, { taskId: task.id });
    },
    alert(level, text, { robotId = null, taskId = null, panel = null } = {}) {
      s.alerts.push({ id: ++s.seq.alert, time: now(), level, text, robotId, taskId, panel });
      keep(s.alerts, 60);
      s.audit.push({ time: now(), actor: robotId || 'ESCRITÓRIO', kind: 'alerta', text, taskId });
      changed();
    },
    setRobot(id, patch) { Object.assign(s.robots[id], patch); changed(); },
    // custo real de um agente (total_cost_usd); devolve true se o orçamento do dia estourou
    charge(robotId, usd, task = null) {
      if (s.spend.day !== dayKey()) s.spend = { day: dayKey(), today: 0, series: [] };
      s.robots[robotId].cost += usd;
      s.spend.today += usd;
      if (task) task.cost = (task.cost || 0) + usd;
      s.spend.series.push(Number(s.spend.today.toFixed(4)));
      keep(s.spend.series, 240);
      changed();
      return s.spend.today >= s.budget;
    },
    newIdeaId: () => `S${++s.seq.idea}`,
    keep,
  };
  return api;
}
