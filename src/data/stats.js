// Métricas do time e resumo do dia, calculados a partir do feed (simulado ou ao vivo).
import { ROBOTS, OFFICE } from './robots.js';

const sameDay = (a, b = new Date()) => a && a.toDateString() === b.toDateString();
const avg = (list) => (list.length ? list.reduce((n, v) => n + v, 0) / list.length : 0);
const fmtMin = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
export const usd = (v) => `US$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// etapas do fluxo, com quem atende cada fila: a mais cheia por robô é o gargalo
const STAGES = [
  { id: 'todo', label: 'Backlog → P.O', cols: ['todo'], kind: 'po' },
  { id: 'dev', label: 'Desenvolvimento', cols: ['dev', 'rework'], kind: 'dev' },
  { id: 'security', label: 'Segurança', cols: ['security'], kind: 'sec' },
  { id: 'qa', label: 'QA', cols: ['qa'], kind: 'qa' },
];

export function computeMetrics(feed) {
  const merged = feed.board.filter((t) => t.column === 'merged' && t.mergedAt);
  const cycle = merged.map((t) => t.mergedAt - new Date(t.createdAt)).filter((v) => v > 0);
  const timeline = feed.board.flatMap((t) => t.timeline || []);
  const count = (re) => timeline.filter((e) => re.test(e.text)).length;
  const qaReviews = count(/^Aprovou|^Reprovou/);
  const secReviews = count(/^Segurança ok|^Falha /);
  const queues = STAGES.map((st) => {
    const size = feed.board.filter((t) => st.cols.includes(t.column)).length;
    const robots = Math.max(1, ROBOTS.filter((r) => r.kind === st.kind).length);
    return { ...st, size, robots, load: size / robots };
  });
  // backlog cheio é trabalho planejado, não gargalo: o gargalo é a etapa de trabalho mais carregada
  const bottleneck = queues.filter((q) => q.id !== 'todo').sort((a, b) => b.load - a.load)[0];
  const costs = feed.reports.map((r) => r.cost).filter((v) => v > 0);
  const perRobot = ROBOTS.map((r) => ({ id: r.id, cost: feed.getState(r.id)?.cost || 0, done: feed.getState(r.id)?.done || 0 }))
    .sort((a, b) => b.cost - a.cost);
  return {
    delivered: feed.delivered.at(-1) ?? 0,
    cycleAvg: cycle.length ? fmtMin(avg(cycle)) : '—',
    qaRejectRate: qaReviews ? count(/^Reprovou/) / qaReviews : 0,
    secRejectRate: secReviews ? count(/^Falha /) / secReviews : 0,
    queues,
    bottleneck: bottleneck && bottleneck.size ? bottleneck : null,
    costPerTask: avg(costs),
    spendToday: feed.spend?.today || 0,
    budget: feed.budget || OFFICE.dailyBudgetUsd,
    perRobot,
  };
}

// agência: o que foi publicado hoje e o que espera aprovação
function marketingLine(feed) {
  const pieces = feed.marketing?.pieces || [];
  const today = pieces.filter((p) => p.publishedAt && sameDay(new Date(p.publishedAt)));
  const reach = today.reduce((n, p) => n + (p.metrics?.reach || 0), 0);
  const waiting = pieces.filter((p) => p.stage === 'aprovação').length;
  return `Marketing: ${today.length} post(s) publicado(s)${today.length ? `, ${reach.toLocaleString('pt-BR')} de alcance` : ''}; ${waiting} criativo(s) esperando você`;
}

// Resumo do dia, em texto pronto para mandar (WhatsApp, e-mail)
export function buildToday(feed) {
  const m = computeMetrics(feed);
  const today = feed.reports.filter((r) => sameDay(r.ts));
  const returned = feed.board.filter((t) => t.rework > 0 && t.column !== 'merged');
  const pending = feed.ideas.filter((i) => i.status === 'aguardando');
  const releases = (feed.releases || []).filter((r) => sameDay(r.ts));
  const incidents = (feed.incidents || []).filter((i) => sameDay(i.ts));
  const findings = today.reduce((n, r) => n + (r.security?.findings.length || 0), 0);
  const lines = [
    `*PetLive · resumo de ${new Date().toLocaleDateString('pt-BR')}*`,
    `Entregues em ${OFFICE.baseBranch}: ${today.length}${today.length ? ` (${today.slice(-6).map((r) => r.title).join(', ')}${today.length > 6 ? '…' : ''})` : ''}`,
    releases.length ? `Em produção: ${releases.map((r) => `${r.version} com ${r.tasks.length} entregas`).join('; ')}` : 'Nenhum release para produção hoje',
    `Segurança: ${findings} falha(s) achada(s) e corrigida(s) antes do merge`,
    incidents.length ? `Erros em produção: ${incidents.length} (${incidents.map((i) => i.error).slice(0, 2).join('; ')})` : 'Produção sem erros novos',
    returned.length ? `Voltaram para correção: ${returned.map((t) => t.id).join(', ')}` : 'Nada voltou para correção',
    m.bottleneck ? `Gargalo: ${m.bottleneck.label} (${m.bottleneck.size} na fila)` : 'Sem gargalo',
    pending.length ? `Esperando você: ${pending.length} (${pending.slice(0, 3).map((i) => i.title).join('; ')}${pending.length > 3 ? '…' : ''})` : 'Nada esperando você',
    marketingLine(feed),
    `Gasto: ${usd(m.spendToday)} de ${usd(m.budget)}`,
  ];
  return { metrics: m, today, returned, pending, releases, incidents, findings, text: lines.join('\n') };
}
