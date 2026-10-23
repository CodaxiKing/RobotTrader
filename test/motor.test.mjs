// O motor de verdade, em modo ensaio: o fluxo inteiro roda sem API, sem git e sem GitHub.
// Cada teste aponta MOTOR_STATE para um arquivo temporário; MOTOR_DRY_FAST=1 deixa o ensaio
// instantâneo, e MOTOR_DRY_EXISTS=1|0 / MOTOR_DRY_FAIL=1|0 forçam as respostas do P.O, da
// segurança e do QA (senão o ensaio sorteia e o teste fica instável).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { robotById } from '../src/data/robots.js';

process.env.MOTOR_DRY_FAST = '1';
const dir = mkdtempSync(path.join(tmpdir(), 'petlive-motor-'));
let seq = 0;
const { createOrchestrator } = await import('../motor/orchestrator.mjs');

const baseConfig = (overrides = {}) => ({
  dryRun: true,
  model: 'claude-opus-5-5',
  dailyBudgetUsd: 500, // alto de propósito: o orçamento do escritório não deve entrar em jogo aqui
  budgets: { default: 2 },
  baseBranch: 'develop',
  productionBranch: 'main',
  releaseBatch: 2,
  meetingAfter: 2,
  appLabels: [],
  extras: {}, // sem robôs de apoio: só o fluxo principal
  project: { number: 1, syncSeconds: 3600, statuses: { todo: 'Todo', doing: 'In Progress', done: 'Done' } },
  repos: { web: { path: dir, testCommand: 'npm test' }, app: { path: dir, testCommand: 'npm test' } },
  limits: { maxRework: 60 },
  ...overrides,
});

// cada teste ganha o seu estado, e o ensaio anda em voltas de 30 ms
function office(overrides = {}) {
  process.env.MOTOR_STATE = path.join(dir, `state-${++seq}.json`);
  const motor = createOrchestrator(baseConfig(overrides));
  return { motor, s: motor.state.data, stop: motor.start({ every: 30 }) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return false;
}
const timeline = (t) => (t.timeline || []).map((e) => String(e.text || ''));
const settled = (s) => s.board.length > 0 && s.board.every((t) => t.column === 'merged');

after(async () => {
  // dá tempo do último save adiado do estado sair antes de apagar a pasta
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
});

test('no ensaio, o fluxo anda do backlog até o merge, apaga a branch e propõe o release', async () => {
  process.env.MOTOR_DRY_EXISTS = '0';
  process.env.MOTOR_DRY_FAIL = '0';
  const { s, stop } = office();
  try {
    assert.ok(await until(() => settled(s)), `não terminou: ${s.board.map((t) => `${t.id}:${t.column}`).join(' ')}`);
    assert.equal(s.deliveredTotal, 12, 'todas as entregas contadas');
    assert.equal(s.reports.length, 12, 'um relatório do QA por entrega');
    // ordem obrigatória: critérios → segurança → QA → merge → branch apagada
    const ev = timeline(s.board[0]);
    let at = -1;
    for (const re of ['Critérios prontos', 'Segurança ok', 'Aprovou · merge', 'apagada']) {
      const i = ev.findIndex((x) => x.includes(re));
      assert.ok(i > at, `esperava "${re}" depois de "${ev[at] || 'o começo'}" em ${JSON.stringify(ev)}`);
      at = i;
    }
    // entregas juntas viram proposta de release; produção só com aprovação
    assert.ok(s.ideas.some((i) => i.focus === 'release' && i.status === 'aguardando'), 'release proposto para o dono');
    assert.equal(s.releases.length, 0, 'nada foi para produção sem aprovação');
  } finally { stop(); }
});

test('quando a funcionalidade já existe, o P.O marca Done sem gastar dev, entrega ou release', async () => {
  process.env.MOTOR_DRY_EXISTS = '1';
  process.env.MOTOR_DRY_FAIL = '0';
  const { s, stop } = office();
  try {
    assert.ok(await until(() => settled(s)), `não terminou: ${s.board.map((t) => `${t.id}:${t.column}`).join(' ')}`);
    assert.ok(s.board.every((t) => t.alreadyDone), 'todas marcadas como "já existiam"');
    assert.equal(s.deliveredTotal, 0, 'não conta como entrega do escritório');
    assert.equal(s.reports.length, 0, 'sem relatório de QA');
    assert.ok(s.board.every((t) => !t.commits.length && !t.pr), 'sem commit nem PR');
    assert.ok(!s.ideas.some((i) => i.focus === 'release'), 'não entra em lote de release');
    assert.ok(timeline(s.board[0]).some((x) => x.includes('Já existia no app')), 'a linha do tempo explica o porquê');
    assert.equal(s.robots.PO_01.done, 12, 'um único agente do P.O por task (o check)');
    assert.ok(s.canvas.screens.filter((sc) => sc.status === 'entregue').length >= 12, 'telas marcadas como entregues no canvas');
  } finally { stop(); }
});

test('correção de erro em produção nunca é marcada como "já existia no app"', async () => {
  process.env.MOTOR_DRY_EXISTS = '1'; // se o check errasse para o lado certo, ele marcaria tudo como Done
  process.env.MOTOR_DRY_FAIL = '0';
  const { s, stop } = office();
  try {
    // como entra uma sugestão do Sentry aprovada por você: task de correção direto no board
    const fix = {
      id: 'S-fix', itemId: null, title: 'Corrigir login quebrado', body: 'erro em produção', area: 'web', origin: 'ops', from: 'OPS_01',
      column: 'todo', dev: null, qa: null, secBy: null, branch: 'fix/corrigir-login-quebrado', commits: [], tests: null, rework: 0,
      findings: [], problems: [], returnedBy: null, criteria: '', createdAt: new Date().toISOString(), mergedAt: null, cost: 0,
      timeline: [], aligned: false, released: null, blocked: false, screen: null,
    };
    s.board.unshift(fix);
    assert.ok(await until(() => fix.column === 'merged'), `a correção não andou: ${fix.column}`);
    assert.ok(!fix.alreadyDone, 'correção não pode virar "já existia"');
    assert.ok(fix.commits.length, 'a correção foi implementada de verdade');
  } finally { stop(); }
});

test('o check de "já existe" fica cacheado por título: mesma tela aprovada duas vezes, um gasto só', async () => {
  process.env.MOTOR_DRY_EXISTS = '1';
  process.env.MOTOR_DRY_FAIL = '0';
  const { s, stop } = office();
  try {
    assert.ok(await until(() => settled(s)), 'o ensaio não terminou');
    const doneBefore = s.robots.PO_01.done;
    const src = s.board.find((t) => t.alreadyDone);
    // o que acontece quando você aprova duas vezes a mesma tela no canvas: task nova, mesmo título
    const dup = {
      ...src, id: 'S-dup', itemId: null, column: 'todo', dev: null, qa: null, secBy: null, mergedAt: null,
      alreadyDone: false, checkedExists: false, blocked: false, parked: null, rework: 0, pr: null, released: null,
      commits: [], findings: [], problems: [], criteria: '', cost: 0, createdAt: new Date().toISOString(),
      timeline: [{ ts: new Date().toISOString(), robotId: 'VOCÊ', text: 'Entrou no Backlog (duplicata)' }],
    };
    s.board.unshift(dup);
    assert.ok(await until(() => dup.column === 'merged'), `a duplicata não andou: ${dup.column}`);
    assert.ok(dup.alreadyDone, 'a duplicata também foi marcada como já existia');
    assert.equal(s.robots.PO_01.done, doneBefore, 'o check veio do cache: nenhum agente novo');
  } finally { stop(); }
});

test('task que volta duas vezes vira reunião e o P.O reescreve os critérios', async () => {
  process.env.MOTOR_DRY_EXISTS = '0';
  process.env.MOTOR_DRY_FAIL = '1';
  const { s, stop } = office();
  try {
    assert.ok(await until(() => s.board.some((t) => t.aligned)), 'nenhum task passou pela reunião');
    const t = s.board.find((x) => x.aligned);
    assert.ok(timeline(t).some((x) => x.includes('critérios reescritos')), 'os critérios não foram reescritos');
    assert.ok(s.audit.some((a) => /reunião para rever os critérios/i.test(a.text)), 'o aviso da reunião não apareceu');
  } finally { stop(); }
});

test('com o P.O pausado, a reunião adia: ninguém vai sem ele', async () => {
  process.env.MOTOR_DRY_EXISTS = '0';
  process.env.MOTOR_DRY_FAIL = '1';
  const { motor, s, stop } = office();
  try {
    // pausa o P.O assim que a primeira task voltar uma vez (antes da segunda volta, que é a reunião)
    assert.ok(await until(() => s.board.some((t) => t.rework >= 1)), 'nenhuma task voltou');
    motor.actions.setRobotPaused('PO_01', true);
    assert.ok(await until(() => s.board.some((t) => t.rework >= 4)), 'as tasks não voltaram de novo');
    assert.ok(!s.audit.some((a) => /reunião para rever os critérios/i.test(a.text)), 'a reunião aconteceu com o P.O pausado');
    assert.ok(s.audit.some((a) => /reunião adiada/i.test(a.text)), 'o adiamento não foi registrado');
  } finally { stop(); }
});

test('teto de gasto por robô pausa só quem estourou, e o resto do escritório segue', async () => {
  process.env.MOTOR_DRY_EXISTS = '0';
  process.env.MOTOR_DRY_FAIL = '0';
  // no ensaio rápido cada agente custa US$ 0,01: com teto de US$ 0,02, cada dev para na 2ª task
  const { s, stop } = office({ robotDailyUsd: { dev: 0.02 } });
  try {
    assert.ok(await until(() => Object.values(s.robots).some((r) => r.paused)), 'nenhum robô pausou no teto');
    assert.equal(s.paused, false, 'o escritório inteiro não deve pausar por teto de um robô');
    assert.ok(s.alerts.some((a) => /teto do dia/.test(a.text)), 'sem aviso do teto por robô');
    const paused = Object.entries(s.robots).filter(([, r]) => r.paused).map(([id]) => id);
    assert.ok(paused.length > 0 && paused.every((id) => robotById(id).kind === 'dev'), `pausou gente que não devia: ${paused.join(', ')}`);
    // o que ficou com o dev pausado espera (comportamento desejado), mas o resto segue entregando
    const deliveredAtPause = s.deliveredTotal;
    assert.ok(await until(() => s.deliveredTotal > deliveredAtPause), 'o escritório parou junto com o dev');
  } finally { stop(); }
});

test('ideia aprovada por você vira task no board e entra no fluxo', async () => {
  process.env.MOTOR_DRY_EXISTS = '0';
  process.env.MOTOR_DRY_FAIL = '0';
  const { motor, s, stop } = office();
  try {
    assert.ok(await until(() => s.board.length === 12), 'o ensaio não montou o backlog');
    s.ideas.push({
      id: 'S99', focus: 'dev', by: 'CODE_01', time: new Date().toISOString(), status: 'aguardando',
      title: 'Implementar botão de exportar agenda', detail: 'exporta os compromissos do pet em .ics', area: 'web',
    });
    await motor.actions.decide('S99', true);
    assert.equal(s.ideas.find((i) => i.id === 'S99').status, 'aprovada', 'a ideia não foi marcada como aprovada');
    const t = s.board.find((x) => x.id === 'S-S99');
    assert.ok(t, 'a ideia aprovada não virou task no board');
    assert.equal(t.column, 'todo', 'a task nova entra no Backlog');
    assert.equal(t.origin, 'idea', 'a task guarda que veio de uma sugestão');
    assert.equal(t.body, 'exporta os compromissos do pet em .ics', 'a task guarda a descrição da melhoria');
    assert.ok(await until(() => t.column === 'merged'), `a task da ideia não andou: ${t.column}`);
    assert.equal(s.ideas.find((i) => i.id === 'S99').taskId, t.id, 'a ideia aponta a task que virou');
  } finally { stop(); }
});

test('release aprovado leva as entregas do lote para produção com a versão', async () => {
  process.env.MOTOR_DRY_EXISTS = '0';
  process.env.MOTOR_DRY_FAIL = '0';
  const { motor, s, stop } = office();
  try {
    assert.ok(await until(() => settled(s)), 'o ensaio não terminou');
    const idea = s.ideas.find((i) => i.focus === 'release' && i.status === 'aguardando');
    assert.ok(idea, 'o release não foi proposto');
    await motor.actions.decide(idea.id, true);
    assert.ok(await until(() => s.releases.length === 1), 'o release não foi para produção');
    const rel = s.releases[0];
    assert.match(rel.version, /^v1\.\d+\.0$/, 'a versão não segue o padrão');
    const lot = new Set(rel.tasks.map((x) => x.id));
    assert.ok(lot.size >= 2, 'o lote tinha pelo menos as entregas mínimas');
    for (const t of s.board.filter((x) => lot.has(x.id))) {
      assert.equal(t.released, rel.version, `${t.id} não recebeu a versão ${rel.version}`);
    }
    assert.equal(s.ideas.find((i) => i.id === idea.id).status, 'aprovada', 'a ideia do release ficou aprovada');
    assert.ok(s.releases[0].notes?.length, 'o release tem notas');
  } finally { stop(); }
});
