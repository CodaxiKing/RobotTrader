// Orquestrador: o mesmo fluxo da simulação, com agentes e git de verdade.
//   GitHub Project (Todo) → P.O escreve os critérios → dev implementa num worktree, commit e push →
//   segurança revisa o diff → QA testa → merge em develop → a cada N entregas, o OPS propõe um
//   release, que só vai para main com a aprovação do dono.
// Task que volta duas vezes vira reunião: o P.O reescreve os critérios com o que falhou.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROBOTS, robotById } from '../src/data/robots.js';
import { createState } from './state.mjs';
import { createGit, createProject } from './git.mjs';
import { createAgents, parseJson } from './agents.mjs';
import { createExtras } from './extras.mjs';

const CANVAS = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/canvas.json', import.meta.url)), 'utf8'));
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const now = () => new Date().toISOString();
const byKind = (kind) => ROBOTS.filter((r) => r.kind === kind);

export function createOrchestrator(config) {
  const { dryRun } = config;
  const base = config.baseBranch;
  const prod = config.productionBranch;
  const state = createState({ budget: config.dailyBudgetUsd });
  const s = state.data;
  const log = (text) => console.log(`  ${text}`);
  const git = createGit({ dryRun, log });
  const project = createProject({ run: git.run, ...config.project, dryRun });
  const agents = createAgents({ model: config.model, budgets: config.budgets, dryRun, log });
  const repoOf = (task) => config.repos[task.area];

  // o canvas vem do snapshot (npm run canvas:snapshot); as telas entregues são marcadas no merge
  if (!s.canvas) {
    s.canvas = {
      title: CANVAS.title, url: CANVAS.url, version: CANVAS.version, syncedAt: CANVAS.syncedAt, changes: [],
      screens: CANVAS.screens.map((sc) => ({ ...sc, name: sc.title.replace(/^\d+ · /, ''), status: sc.phase >= 3 ? 'futuro' : 'planejada', outdated: false, taskId: null })),
    };
  }
  const screenFor = (title) => s.canvas.screens.find((sc) => slug(sc.name) === slug(title));

  function addTask({ id, itemId = null, title, body = '', area, origin = 'board', from = null, priority = null, fase = null }) {
    const prefix = origin === 'security' || origin === 'ops' ? 'fix' : 'feat';
    const sc = screenFor(title);
    const task = {
      id, itemId, title, body, area, origin, from, priority, fase, column: 'todo', dev: null, qa: null, secBy: null,
      branch: `${prefix}/${slug(title.replace(/^\[[^\]]+\]\s*/, ''))}`, commits: [], tests: null, rework: 0, findings: [], problems: [],
      returnedBy: null, criteria: '', createdAt: now(), mergedAt: null, cost: 0, timeline: [], aligned: false,
      released: null, blocked: false, screen: sc?.file || null,
    };
    if (sc) sc.taskId = id;
    s.board.push(task);
    task.timeline.push({ ts: now(), robotId: from || 'PO_01', text: `Entrou no Backlog${from ? ` (${from})` : ''}` });
    return task;
  }

  // ── board: itens do GitHub Project na coluna Todo viram tasks ──
  // A área sai do prefixo do título ([APP-CLIENTE], [WEB]…, em project.areas); sem prefixo, das labels.
  const areaOf = (item) => {
    const prefix = item.title.match(/^\[([^\]]+)\]/)?.[1];
    if (prefix && config.project.areas?.[prefix]) return config.project.areas[prefix];
    const labels = (item.labels || item.content?.labels || []).map((l) => String(l.name || l).toLowerCase());
    const text = `${item.title} ${item.content?.repository || ''}`.toLowerCase();
    return labels.some((l) => config.appLabels.includes(l)) || config.appLabels.some((l) => text.includes(l)) ? 'app' : 'web';
  };
  // só entra o que está no escopo combinado: fases, prioridades e nada da lista de itens que não são código
  const inScope = (item) => {
    const p = config.project;
    if (p.fases?.length && !p.fases.some((f) => String(item.fase || '').startsWith(f))) return false;
    if (p.priorities?.length && !p.priorities.includes(item.priority)) return false;
    if (p.skip?.some((re) => new RegExp(re, 'i').test(item.title))) return false;
    return !!config.project.areas?.[item.title.match(/^\[([^\]]+)\]/)?.[1]] || !config.project.areas;
  };
  const rank = (t) => (config.project.priorities || []).indexOf(t.priority) + 1 || 99;
  // o backlog fica na ordem de prioridade (P0 primeiro); o que você priorizou à mão continua na frente
  function sortBacklog() {
    const todo = s.board.filter((t) => t.column === 'todo');
    const rest = s.board.filter((t) => t.column !== 'todo');
    todo.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || rank(a) - rank(b));
    s.board.splice(0, s.board.length, ...rest, ...todo);
  }
  async function syncProject() {
    if (dryRun) {
      // ensaio: o backlog sai da Fase 1 do canvas, como na simulação
      if (!s.board.length) s.canvas.screens.filter((sc) => sc.phase === 1).slice(0, 12).forEach((sc, i) => addTask({ id: `#${101 + i}`, title: sc.name, area: sc.kind === 'app' ? 'app' : 'web' }));
      return state.changed();
    }
    const items = await project.items();
    let added = 0;
    for (const item of items) {
      if (item.status !== config.project.statuses.todo || s.board.some((t) => t.itemId === item.id) || !inScope(item)) continue;
      addTask({ id: item.content?.number ? `#${item.content.number}` : `P-${item.id.slice(-5)}`, itemId: item.id, title: item.title, body: item.content?.body || '', area: areaOf(item), priority: item.priority, fase: item.fase });
      added++;
    }
    if (added) {
      sortBacklog();
      state.push('PO_01', `Trouxe ${added} item(ns) do GitHub Project para o Backlog (${(config.project.fases || []).join(', ')} · ${(config.project.priorities || []).join(', ')})`);
    }
  }

  // ── execução de um passo de um robô, com custo, erro e orçamento ──
  const reserved = (id) => s.board.some((t) => t.column === 'refining' && t.dev === id);
  const busy = (id) => s.robots[id].status !== 'idle' || s.robots[id].paused || reserved(id);
  async function work(robotId, task, activity, fn) {
    state.setRobot(robotId, { status: 'working', taskId: task?.id || null, progress: 0.1, activity });
    try {
      await fn();
    } catch (err) {
      if (task) {
        task.blocked = true;
        state.step(task, robotId, `Travou: ${err.message}`);
      }
      state.alert('danger', `${robotId} travou${task ? ` em ${task.id}` : ''}: ${err.message}`, { robotId, taskId: task?.id, panel: 'board' });
    } finally {
      state.setRobot(robotId, { status: 'idle', taskId: null, progress: 0, activity: 'Livre' });
    }
  }
  async function agent(robotId, role, task, opts) {
    const res = await agents.run(role, opts);
    s.robots[robotId].done++;
    if (state.charge(robotId, res.cost, task) && !s.paused) {
      setPaused(true, `orçamento do dia (US$ ${s.budget}) atingido`);
      state.alert('danger', `Orçamento do dia atingido (US$ ${s.spend.today.toFixed(2)}): o escritório pausou.`, { panel: 'metrics' });
    }
    if (!res.ok) throw new Error(`o agente parou (${res.subtype})`);
    return res.text;
  }
  const brief = (t) => `Task ${t.id}: ${t.title}\n\n${t.body || ''}${t.criteria ? `\n\nCritérios de aceite:\n${t.criteria}` : ''}`;

  // P.O: critérios de aceite e passa para um dev livre da área
  function refine(task, devId) {
    // o dev fica reservado enquanto o P.O refina, para não pegar outra coisa no meio
    Object.assign(task, { column: 'refining', dev: devId });
    return work('PO_01', task, 'Escrevendo critérios de aceite', async () => {
      task.criteria = await agent('PO_01', 'po', task, { prompt: brief(task), cwd: repoOf(task).path });
      Object.assign(task, { column: 'dev', dev: devId });
      state.step(task, 'PO_01', `Critérios prontos · passou para ${devId}`);
      await project.move(task.itemId, 'doing');
      develop(task, devId);
    });
  }

  function develop(task, devId) {
    task.column = 'dev';
    const fixing = task.rework > 0;
    return work(devId, task, fixing ? 'Corrigindo o que voltou' : 'Implementando', async () => {
      const repo = repoOf(task);
      task.worktree = await git.taskWorktree(repo, task.branch, base);
      state.step(task, devId, fixing ? 'Voltou para corrigir' : `Pegou a task · branch ${task.branch}`);
      const toFix = fixing
        ? `\n\nO que voltou para corrigir:\n${task.returnedBy === 'security'
          ? task.findings.filter((f) => f.open).map((f) => `- [${f.severity}] ${f.title}: ${f.fix}${f.file ? ` (${f.file})` : ''}`).join('\n')
          : task.problems.map((p) => `- ${p}`).join('\n')}`
        : '';
      const summary = await agent(devId, 'dev', task, { prompt: `${brief(task)}${toFix}`, cwd: task.worktree });
      const type = fixing || task.origin === 'security' || task.origin === 'ops' ? 'fix' : 'feat';
      const commits = await git.commitAndPush(task.worktree, task.branch, base, `${type}(${slug(task.title).split('-')[0]}): ${task.title.toLowerCase()}`);
      const known = new Set(task.commits.map((c) => c.sha));
      for (const c of commits) if (!known.has(c.sha)) task.commits.push({ ...c, time: now() });
      s.robots[devId].commits += commits.length;
      task.findings.forEach((f) => (f.open = false));
      task.column = 'security';
      state.step(task, devId, `Push em ${task.branch} · ${summary.split('\n')[0].slice(0, 160)}`);
    });
  }

  function review(task, secId) {
    task.secBy = secId;
    task.secReviewer = secId;
    return work(secId, task, 'Revisando o diff', async () => {
      state.step(task, secId, 'Começou a revisão de segurança');
      const text = await agent(secId, 'sec', task, { prompt: `${brief(task)}\n\nRevise o que a branch ${task.branch} mudou: git diff origin/${base}...HEAD`, cwd: task.worktree });
      const verdict = parseJson(text);
      task.secBy = null;
      const serious = (verdict.findings || []).filter((f) => f.severity !== 'baixa');
      if (!verdict.ok || serious.length) {
        task.findings.push(...serious.map((f) => ({ ...f, open: true })));
        Object.assign(task, { column: 'rework', returnedBy: 'security' });
        task.rework++;
        state.step(task, secId, `Falha ${serious[0]?.severity || 'média'}: ${serious[0]?.title || 'ver parecer'} · voltou para ${task.dev}`);
        if (serious.some((f) => f.severity === 'alta')) state.alert('danger', `Falha alta em ${task.id}: ${serious[0].title}`, { robotId: secId, taskId: task.id, panel: 'board' });
        return meeting(task, secId);
      }
      task.column = 'qa';
      state.step(task, secId, `Segurança ok${task.findings.length ? ` · ${task.findings.length} falha(s) corrigida(s)` : ''} · mandou para o QA`);
    });
  }

  function test(task, qaId) {
    task.qa = qaId;
    return work(qaId, task, 'Rodando os testes', async () => {
      const repo = repoOf(task);
      state.step(task, qaId, 'Começou a testar');
      const text = await agent(qaId, 'qa', task, { prompt: `${brief(task)}\n\nComando de testes do projeto: ${repo.testCommand}`, cwd: task.worktree });
      const r = parseJson(text);
      task.tests = { total: r.total || 0, passed: r.passed || 0, failed: r.failed || 0 };
      if (!r.ok) {
        Object.assign(task, { column: 'rework', qa: null, returnedBy: 'qa', problems: r.problems?.length ? r.problems : [r.summary] });
        task.rework++;
        state.step(task, qaId, `Reprovou: ${r.summary}`);
        return meeting(task, qaId);
      }
      await git.mergeInto(repo, task.branch, base);
      Object.assign(task, { column: 'merged', mergedAt: now() });
      s.deliveredTotal++;
      const sc = task.screen && s.canvas.screens.find((x) => x.file === task.screen);
      if (sc) { Object.assign(sc, { status: 'entregue', outdated: false }); s.canvas.changes.push({ time: now(), text: `Marcou "${sc.name}" como entregue (${task.id})` }); }
      s.reports.push({
        taskId: task.id, title: task.title, area: task.area, dev: task.dev, qa: qaId, branch: task.branch,
        commits: task.commits.length, tests: task.tests, rework: task.rework, time: now(), cost: task.cost,
        security: { reviewer: task.secReviewer || 'SEC_01', findings: task.findings.map(({ severity, title }) => ({ severity, title })) },
        summary: `${r.summary} Merge feito em ${base}; vai para ${prod} no próximo release.`,
      });
      state.keep(s.reports, 60);
      s.changelog.push({ time: now(), taskId: task.id, kind: task.origin === 'security' || task.origin === 'ops' ? 'Corrigido' : 'Novo', text: `${task.origin === 'security' || task.origin === 'ops' ? 'Corrigido' : 'Novo'}: ${task.title}` });
      extras.onMerged(task);
      state.step(task, qaId, `Aprovou · merge em ${base} · relatório pronto`);
      mergesThisRun++;
      const stopAt = config.limits?.pauseAfterMerges;
      if (stopAt && mergesThisRun >= stopAt) {
        setPaused(true, `piloto: ${mergesThisRun} entrega(s) em ${base}; revise e continue quando quiser`);
        state.alert('warn', `Piloto concluído: ${task.id} "${task.title}" foi para ${base}. Revise o merge e clique em Continuar.`, { taskId: task.id, panel: 'reports' });
      }
      await project.move(task.itemId, 'done');
      await git.removeWorktree(repo, task.worktree);
    });
  }

  // reunião de verdade: com o que falhou, o P.O reescreve os critérios antes da próxima tentativa
  async function meeting(task, reviewerId) {
    if (task.rework < config.meetingAfter || task.aligned || s.meeting) return;
    const people = ['PO_01', task.dev, reviewerId];
    s.meeting = { taskId: task.id, robots: people, until: null };
    people.forEach((id) => state.setRobot(id, { status: 'meeting', taskId: task.id, activity: `Reunião sobre ${task.id}` }));
    state.alert('warn', `${task.id} voltou ${task.rework} vezes: reunião para rever os critérios`, { taskId: task.id, panel: 'board' });
    try {
      const failed = [...task.findings.map((f) => `[segurança] ${f.title}`), ...task.problems.map((p) => `[QA] ${p}`)].join('\n');
      task.criteria = await agent('PO_01', 'po', task, { prompt: `${brief(task)}\n\nEla voltou ${task.rework} vezes por:\n${failed}\nReescreva os critérios de aceite deixando claro o que precisa mudar para passar.`, cwd: repoOf(task).path });
      task.aligned = true;
      state.step(task, 'PO_01', 'Reunião terminou: critérios reescritos com o que falhou');
    } finally {
      s.meeting = null;
      people.forEach((id) => { if (s.robots[id].status === 'meeting') state.setRobot(id, { status: 'idle', taskId: null, activity: 'Livre' }); });
    }
  }

  // ── release: o OPS propõe, o dono aprova, e só então vai para main ──
  function proposeRelease() {
    const ready = s.board.filter((t) => t.column === 'merged' && !t.released);
    if (ready.length < config.releaseBatch || s.ideas.some((i) => i.focus === 'release' && i.status === 'aguardando')) return;
    const version = `v1.${s.releases.length + 1}.0`;
    s.ideas.push({
      id: state.newIdeaId(), focus: 'release', by: 'OPS_01', time: now(), status: 'aguardando', title: `Release ${version} para produção`, tasks: ready.map((t) => t.id),
      detail: `${ready.length} entregas testadas em ${base}: ${ready.map((t) => t.title).join(', ')}. Aprovar faz o merge em ${prod}.`,
    });
    state.alert('info', `OPS_01 espera você: release ${version} com ${ready.length} entregas`, { robotId: 'OPS_01', panel: 'ideas' });
  }

  async function release(idea) {
    const version = idea.title.match(/v[\d.]+/)[0];
    const tasks = idea.tasks.map((id) => state.task(id)).filter(Boolean);
    await work('OPS_01', null, `Fazendo o deploy do ${version}`, async () => {
      for (const area of new Set(tasks.map((t) => t.area))) await git.mergeInto(config.repos[area], base, prod);
      tasks.forEach((t) => { t.released = version; t.timeline.push({ ts: now(), robotId: 'OPS_01', text: `Foi para produção no ${version}` }); });
      const notes = await extras.releaseNotes(tasks);
      s.releases.push({ version, time: now(), tasks: tasks.map((t) => ({ id: t.id, title: t.title, area: t.area })), notes });
      state.push('OPS_01', `${version} em ${prod} (aprovado por você)`, { kind: 'release' });
    });
  }

  const extras = createExtras({ config, state, agent, work, git, repoOf });
  let mergesThisRun = 0;

  // ── agenda: a cada volta, quem está livre pega o próximo trabalho ──
  let syncing = null;
  let lastSync = 0;
  function schedule() {
    if (s.paused) return;
    if (Date.now() - lastSync > config.project.syncSeconds * 1000 && !syncing) {
      lastSync = Date.now();
      syncing = syncProject().catch((err) => state.alert('warn', `Não li o GitHub Project: ${err.message}`)).finally(() => (syncing = null));
    }
    const ready = (t) => !t.blocked;
    // correções voltam para o mesmo dev antes de qualquer task nova
    for (const dev of byKind('dev')) {
      if (busy(dev.id)) continue;
      const back = s.board.find((t) => ready(t) && t.column === 'rework' && t.dev === dev.id);
      if (back) develop(back, dev.id);
    }
    const active = s.board.filter((t) => ['refining', 'dev', 'security', 'qa', 'rework'].includes(t.column)).length;
    if (!busy('PO_01') && active < (config.limits?.maxActive || Infinity)) {
      const free = byKind('dev').filter((d) => !busy(d.id) && !s.board.some((t) => t.column === 'rework' && t.dev === d.id));
      const next = s.board.find((t) => ready(t) && t.column === 'todo' && free.some((d) => d.area === t.area));
      if (next) refine(next, free.find((d) => d.area === next.area).id);
    }
    for (const sec of byKind('sec')) {
      if (busy(sec.id)) continue;
      const next = s.board.find((t) => ready(t) && t.column === 'security' && !t.secBy);
      if (next) review(next, sec.id);
    }
    for (const qa of byKind('qa')) {
      if (busy(qa.id)) continue;
      const next = s.board.find((t) => ready(t) && t.column === 'qa' && !t.qa && t.area === qa.area);
      if (next) test(next, qa.id);
    }
    proposeRelease();
    extras.tick();
  }

  // ── ações do dono (vêm da tela pelo servidor) ──
  function setPaused(value, reason = null) {
    s.paused = value;
    s.pauseReason = value ? reason || 'pausado por você' : null;
    if (!reason) state.decision(value ? 'Pausou o escritório' : 'Retomou o escritório');
    state.changed();
  }
  async function decide(id, approved) {
    const idea = s.ideas.find((i) => i.id === id && i.status === 'aguardando');
    if (!idea) return;
    Object.assign(idea, { status: approved ? 'aprovada' : 'recusada', decidedAt: now() });
    state.decision(`${approved ? 'Aprovou' : 'Recusou'}: ${idea.title}`);
    // posts e divulgação são da agência
    if (extras.decide(idea, approved)) return;
    if (!approved) return;
    if (idea.focus === 'release') return release(idea);
    // sugestão aprovada vira item do GitHub Project (e task no board)
    const itemId = await project.create(idea.title, idea.detail);
    const t = addTask({ id: `S-${idea.id}`, itemId, title: idea.title.replace(/^(Implementar|Nova tela:)\s*"?|"$/g, ''), body: idea.detail, area: idea.area || 'web', origin: 'idea', from: idea.by });
    idea.taskId = t.id;
    state.push(idea.by, `Aprovada por você · virou ${t.id} no Backlog`, { taskId: t.id });
  }
  function prioritize(taskId, beforeId = null) {
    const t = state.task(taskId);
    if (!t || t.column !== 'todo') return false;
    t.blocked = false;
    t.pinned = true;
    s.board.splice(s.board.indexOf(t), 1);
    const before = beforeId ? state.task(beforeId) : s.board.find((x) => x.column === 'todo');
    s.board.splice(before ? s.board.indexOf(before) : s.board.length, 0, t);
    state.decision(`Moveu ${t.id} no Backlog`, t.id);
    return true;
  }
  async function ask(robotId, text) {
    const r = s.robots[robotId];
    if (!r) return 'Não conheço esse robô.';
    state.decision(`Para ${robotId}: ${text}`);
    const prio = text.toLowerCase().match(/prioriz\w*\s+(#[\w-]+)/);
    let answer;
    if (prio) answer = prioritize(prio[1]) ? `Feito: ${prio[1]} é a próxima do Backlog.` : `${prio[1]} não está no Backlog.`;
    else {
      const t = r.taskId && state.task(r.taskId);
      const context = {
        robo: robotId, papel: robotById(robotId)?.roleLabel, estado: r,
        task: t && { id: t.id, titulo: t.title, coluna: t.column, voltou: t.rework, falhas: t.findings, problemas: t.problems, criterios: t.criteria },
        ultimos_eventos: s.events.filter((e) => e.robotId === robotId).slice(-10),
      };
      answer = await agent(robotId, 'chat', t, { prompt: `Contexto:\n${JSON.stringify(context, null, 1)}\n\nPergunta do dono: ${text}` }).catch((err) => `Não consegui responder agora: ${err.message}`);
    }
    s.audit.push({ time: now(), actor: robotId, kind: 'conversa', text: answer });
    state.changed();
    return answer;
  }

  return {
    state,
    start() {
      syncProject().catch((err) => state.alert('warn', `Não li o GitHub Project: ${err.message}`));
      lastSync = Date.now();
      setInterval(schedule, 2000);
      state.push('OPS_01', dryRun ? 'Motor ligado em modo de ensaio (sem API, sem git, sem GitHub)' : `Motor ligado · ${Object.keys(config.repos).join(' e ')} · Project #${config.project.number}`);
    },
    actions: {
      decide,
      setPaused: (v) => setPaused(v),
      adjustIdea: (id, note) => extras.adjust(id, note),
      setRobotPaused(id, v) { if (s.robots[id]) { s.robots[id].paused = v; state.decision(`${v ? 'Pausou' : 'Retomou'} ${id}`); } },
      setBudget(usd) {
        s.budget = Math.max(1, Math.round(usd));
        state.decision(`Mudou o orçamento do dia para US$ ${s.budget}`);
        if (s.paused && /orçamento/.test(s.pauseReason || '') && s.spend.today < s.budget) setPaused(false);
      },
      prioritize: (taskId, beforeId) => { const ok = prioritize(taskId, beforeId); state.changed(); return ok; },
      ask,
    },
  };
}
