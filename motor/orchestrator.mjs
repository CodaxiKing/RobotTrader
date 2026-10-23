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
import { createAgents, parseJson, CLAUDE_MODELS } from './agents.mjs';
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
  // IA dos robôs, por grupo: Desenvolvimento (todo o resto), Melhorias (sala 06) e Marketing (sala 07).
  // Cada uma é Claude (Agent SDK) ou OpenCode com um modelo; Melhorias e Marketing em null seguem a de Desenvolvimento.
  if (s.ai && !s.ai.slots) s.ai = { slots: { main: { provider: s.ai.provider, model: s.ai.models[s.ai.provider] }, ideas: null, marketing: null } };
  s.ai ||= { slots: { main: { provider: config.ai?.provider || 'claude', model: config.model }, ideas: null, marketing: null } };
  const SLOTS = ['main', 'ideas', 'marketing'];
  const SLOT_LABEL = { main: 'Desenvolvimento', ideas: 'Melhorias', marketing: 'Marketing' };
  const slotOf = (robotId) => ({ lab: 'ideas', mkt: 'marketing' })[robotById(robotId)?.floor] || 'main';
  const aiFor = (slot = 'main') => s.ai.slots[slot] || s.ai.slots.main;
  const aiLabel = (slot = 'main') => `${aiFor(slot).provider === 'claude' ? 'Claude' : 'OpenCode'} · ${aiFor(slot).model}`;
  // ritmo: 'one' = uma task por vez (e a pausa do piloto); 'all' = cada dev livre pega uma task da área dele
  s.mode ||= config.limits?.maxActive === 1 ? 'one' : 'all';
  const maxActive = () => (s.mode === 'one' ? 1 : config.limits?.maxParallel || Infinity);
  const agents = createAgents({ model: config.model, budgets: config.budgets, dryRun, log, onRateLimit, ai: aiFor, usesClaude: () => SLOTS.some((sl) => aiFor(sl).provider === 'claude') });
  const repoOf = (task) => config.repos[task.area];

  // ── plano da conta Claude: % usado nas janelas de 5h e semanal, e a espera quando acaba ──
  // Quando o limite acaba no meio, a task fica estacionada com o mesmo robô e o motor retoma sozinho na renovação.
  s.plan ||= { available: false, name: null, session: null, weekly: null, waitUntil: null, checkedAt: null };
  const hhmm = (ms) => new Date(ms).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', ...(ms - Date.now() > 20 * 3600e3 ? { weekday: 'short' } : {}) });
  // a espera do plano para o escritório quando o Desenvolvimento é Claude (o grosso do trabalho)
  const planWaiting = () => aiFor('main').provider === 'claude' && !!s.plan.waitUntil && Date.now() < s.plan.waitUntil;
  let checkingPlan = null;
  function refreshPlan() {
    if (checkingPlan) return checkingPlan;
    checkingPlan = (async () => {
      const u = await agents.usage();
      if (!u) return;
      Object.assign(s.plan, { available: u.available, name: u.name, session: u.session || null, weekly: u.weekly || null, checkedAt: now() });
      // janela cheia sem nenhum robô ter batido nela ainda (ex.: você usou o Claude Code na mesma conta)
      const full = [u.session, u.weekly].filter((w) => w && w.used >= 100 && w.resetsAt > Date.now());
      if (full.length) holdForPlan(Math.max(...full.map((w) => w.resetsAt)));
      state.changed();
    })().catch((err) => log(`uso do plano: ${err.message}`)).finally(() => (checkingPlan = null));
    return checkingPlan;
  }
  // o Claude Code avisa durante o trabalho: atualiza a janela que mudou sem esperar a próxima leitura
  function onRateLimit(info) {
    const key = info.rateLimitType === 'five_hour' ? 'session' : info.rateLimitType === 'seven_day' ? 'weekly' : null;
    if (key && info.utilization != null) {
      const resetsAt = info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : s.plan[key]?.resetsAt ?? null;
      s.plan[key] = { used: Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization), resetsAt };
      s.plan.available = true;
      state.changed();
    }
  }
  function holdForPlan(resetsAt) {
    // sem horário de renovação, tenta de novo em 15 minutos (a leitura do plano corrige se souber)
    const until = resetsAt && resetsAt > Date.now() ? resetsAt + 60e3 : Date.now() + 15 * 60e3;
    if (planWaiting() && s.plan.waitUntil >= until) return;
    const first = !planWaiting();
    s.plan.waitUntil = until;
    if (first) {
      state.push('OPS_01', `Limite do plano acabou: os robôs esperam e continuam sozinhos às ${hhmm(until)}`);
      state.alert('warn', `Limite do plano Claude acabou. As tasks ficam paradas com o mesmo robô e voltam sozinhas às ${hhmm(until)}.`, { panel: 'board' });
    }
    state.changed();
  }
  // a task parada no meio volta para um ponto de onde o fluxo retoma com o mesmo robô
  function park(task, robotId) {
    task.parked = { column: task.column, robotId, at: now() };
    if (task.column === 'security') task.secBy = null;
    if (task.column === 'qa') task.qa = null;
    state.step(task, robotId, `Limite do plano acabou no meio · continua às ${hhmm(s.plan.waitUntil)}`);
  }
  function resumeParked() {
    for (const t of s.board.filter((x) => x.parked)) {
      const { column, robotId } = t.parked;
      if (column === 'refining' && !busy('PO_01')) { t.parked = null; refine(t, t.dev); }
      else if ((column === 'dev' || column === 'rework') && t.dev && !s.robots[t.dev].paused && s.robots[t.dev].status === 'idle') {
        t.parked = null;
        state.step(t, t.dev, 'Plano renovado · voltou a implementar de onde parou');
        develop(t, t.dev);
      } else if (column === 'security' || column === 'qa') {
        // a segurança e o QA da agenda pegam de novo; o mesmo robô tem a vez se estiver livre
        t.parked = null;
        if (column === 'security' && !busy(robotId)) review(t, robotId);
        if (column === 'qa' && !busy(robotId)) test(t, robotId);
      }
    }
  }

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
  const reserved = (id) => s.board.some((t) => (t.column === 'refining' || t.parked) && t.dev === id);
  const busy = (id) => s.robots[id].status !== 'idle' || s.robots[id].paused || reserved(id);
  async function work(robotId, task, activity, fn) {
    state.setRobot(robotId, { status: 'working', taskId: task?.id || null, progress: 0.1, activity });
    let parked = false;
    try {
      await fn();
    } catch (err) {
      if (err.planLimit) {
        holdForPlan(err.resetsAt);
        refreshPlan();
        if (task) { park(task, robotId); parked = true; }
        return;
      }
      if (task) {
        task.blocked = true;
        state.step(task, robotId, `Travou: ${err.message}`);
      }
      state.alert('danger', `${robotId} travou${task ? ` em ${task.id}` : ''}: ${err.message}`, { robotId, taskId: task?.id, panel: 'board' });
    } finally {
      state.setRobot(robotId, parked
        ? { status: 'idle', taskId: task.id, progress: 0, activity: `Esperando o plano renovar (${hhmm(s.plan.waitUntil)})` }
        : { status: 'idle', taskId: null, progress: 0, activity: 'Livre' });
    }
  }
  async function agent(robotId, role, task, opts) {
    const res = await agents.run(role, { ...opts, slot: slotOf(robotId) });
    s.robots[robotId].done++;
    if (state.charge(robotId, res.cost, task) && !s.paused) {
      setPaused(true, `orçamento do dia (US$ ${s.budget}) atingido`);
      state.alert('danger', `Orçamento do dia atingido (US$ ${s.spend.today.toFixed(2)}): o escritório pausou.`, { panel: 'metrics' });
    }
    // teto do dia por robô (robotDailyUsd: número, ou mapa por papel): só quem estourou para;
    // a task fica com ele esperando, e o resto do escritório segue gastando. Compara com o gasto
    // de hoje (costToday zera quando o dia vira); cost é o acumulado, que fica só nas métricas
    const cap = typeof config.robotDailyUsd === 'number' ? config.robotDailyUsd : config.robotDailyUsd?.[role] ?? config.robotDailyUsd?.default;
    const spentToday = s.robots[robotId].costToday ?? s.robots[robotId].cost;
    if (cap != null && spentToday >= cap && !s.robots[robotId].paused) {
      state.setRobot(robotId, { paused: true, pausedBy: 'teto' });
      state.alert('warn', `${robotId} bateu o teto do dia (US$ ${cap}) e parou só ele: a ${task?.id || 'tarefa'} fica com ele até o dia virar (ou você retomar).`, { robotId, taskId: task?.id, panel: 'metrics' });
      state.push('OPS_01', `${robotId} pausou no teto do dia (US$ ${cap})`);
    }
    if (!res.ok) throw new Error(`o agente parou (${res.subtype})`);
    return res.text;
  }
  const shortTitle = (t) => t.title.replace(/^\[[^\]]+\]\s*/, '');
  const commitMessage = (t, type) => `${type}(${slug(shortTitle(t)).split('-')[0]}): ${shortTitle(t).toLowerCase()}`;
  // descrição do PR: o que a task pede, os critérios do P.O e o que o dev fez
  const prBody = (t, devId, summary) => [
    `## Task\n${t.title}${t.itemId ? ` (${t.id} no GitHub Project)` : ''}${t.priority ? ` · ${t.priority}` : ''}${t.fase ? ` · ${t.fase}` : ''}`,
    t.body ? `## Descrição\n${t.body}` : '',
    t.criteria ? `## Critérios de aceite (P.O)\n${t.criteria}` : '',
    `## O que o dev fez (${devId})\n${summary}`,
    `---\nAberto pelo escritório de robôs. A segurança e o QA comentam aqui; o merge em \`${base}\` acontece quando o QA aprova.`,
  ].filter(Boolean).join('\n\n');
  const brief = (t) => `Task ${t.id}: ${t.title}\n\n${t.body || ''}${t.criteria ? `\n\nCritérios de aceite:\n${t.criteria}` : ''}`;

  // P.O: antes de escrever os critérios, confere se a funcionalidade já está implementada no app;
  // já estando, a task vira Done no Project e no board, sem gastar um dev. A resposta fica em cache
  // por título (s.existsCache), para a mesma tela aprovada duas vezes não gastar o check duas vezes
  function refine(task, devId) {
    // o dev fica reservado enquanto o P.O refina, para não pegar outra coisa no meio
    Object.assign(task, { column: 'refining', dev: devId });
    return work('PO_01', task, 'Conferindo se já existe no app', async () => {
      const repo = repoOf(task);
      // correção (segurança/produção) ou volta do QA nunca entra aqui: "já existe" não corrige furo
      const isFix = task.origin === 'security' || task.origin === 'ops' || task.rework > 0;
      if (!task.checkedExists && !isFix) {
        // o mesmo título aprovado duas vezes no canvas vira a mesma resposta: confere uma vez só
        const key = slug(shortTitle(task));
        let exists = s.existsCache?.[key] || null;
        if (!exists) {
          try {
            exists = parseJson(await agent('PO_01', 'existsCheck', task, { prompt: brief(task), cwd: repo.path }));
          } catch (err) {
            if (err.planLimit) throw err; // plano acabou: estaciona e reconfere na volta, sem marcar como checado
            exists = null; /* outra falha: segue o fluxo normal */
          }
          if (exists) { s.existsCache ||= {}; s.existsCache[key] = exists; }
        }
        task.checkedExists = true;
        if (exists?.implemented) {
          Object.assign(task, { column: 'merged', mergedAt: now(), dev: null, alreadyDone: true });
          state.step(task, 'PO_01', `Já existia no app (${exists.evidence || 'conferido no código'}) · marquei como Done, sem implementar de novo`);
          const sc = task.screen && s.canvas.screens.find((x) => x.file === task.screen);
          if (sc) {
            Object.assign(sc, { status: 'entregue', outdated: false });
            s.canvas.changes.push({ time: now(), text: `Marcou "${sc.name}" como entregue (${task.id}): já estava no código` });
          }
          await project.move(task.itemId, 'done');
          return;
        }
      }
      state.setRobot('PO_01', { activity: 'Escrevendo critérios de aceite' });
      task.criteria = await agent('PO_01', 'po', task, { prompt: brief(task), cwd: repo.path });
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
      const commits = await git.commitAndPush(task.worktree, task.branch, base, commitMessage(task, type));
      const known = new Set(task.commits.map((c) => c.sha));
      for (const c of commits) if (!known.has(c.sha)) task.commits.push({ ...c, time: now() });
      s.robots[devId].commits += commits.length;
      task.findings.forEach((f) => (f.open = false));
      state.step(task, devId, `Push em ${task.branch} · ${summary.split('\n')[0].slice(0, 160)}`);
      await publishPr(task, devId, summary, fixing);
      task.column = 'security';
    });
  }

  // abre o PR depois do primeiro push; nas correções, comenta no mesmo PR o que mudou
  async function publishPr(task, devId, summary, fixing) {
    const repo = repoOf(task);
    if (!task.pr) {
      task.pr = await git.openPr(repo, { head: task.branch, base, title: task.title, body: prBody(task, devId, summary) });
      state.step(task, devId, `Abriu o pull request${task.pr.number ? ` #${task.pr.number}` : ''} para ${base}`);
    } else if (fixing) {
      await git.commentPr(repo, task.pr, `🔧 **Correções enviadas (${devId})**\n\n${summary}`);
    }
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
        await git.commentPr(repoOf(task), task.pr, `🛡 **Revisão de segurança (${secId}): voltou para correção**\n\n${serious.map((f) => `- **${f.severity}** · ${f.title}${f.file ? ` (\`${f.file}\`)` : ''}\n  ${f.fix}`).join('\n')}`);
        if (serious.some((f) => f.severity === 'alta')) state.alert('danger', `Falha alta em ${task.id}: ${serious[0].title}`, { robotId: secId, taskId: task.id, panel: 'board' });
        if (stopIfLooping(task, secId)) return;
        return meeting(task, secId);
      }
      task.column = 'qa';
      await git.commentPr(repoOf(task), task.pr, `🛡 **Revisão de segurança (${secId}): ok**${task.findings.length ? `\n\n${task.findings.length} falha(s) apontadas antes foram corrigidas.` : ''}${(verdict.findings || []).length ? `\n\nObservações de gravidade baixa:\n${verdict.findings.map((f) => `- ${f.title}: ${f.fix}`).join('\n')}` : ''}`);
      state.step(task, secId, `Segurança ok${task.findings.length ? ` · ${task.findings.length} falha(s) corrigida(s)` : ''} · mandou para o QA`);
    });
  }

  // task que vai e volta sem sair do lugar (ex.: o QA sem conseguir rodar os testes) para e espera você,
  // em vez de gastar a cada volta; "Destravar" na linha do tempo da task dá mais N voltas
  function stopIfLooping(task, robotId) {
    const max = config.limits?.maxRework ?? 5;
    if (task.rework - (task.reworkBase || 0) < max) return false;
    task.blocked = true;
    state.step(task, robotId, `Voltou ${task.rework} vezes: parei a task para você olhar antes de gastar mais`);
    state.alert('danger', `${task.id} voltou ${task.rework} vezes e foi parada para você olhar: ${task.title}`, { robotId, taskId: task.id, panel: 'board' });
    return true;
  }
  function unblock(taskId) {
    const t = state.task(taskId);
    if (!t?.blocked) return false;
    Object.assign(t, { blocked: false, reworkBase: t.rework });
    state.decision(`Destravou ${t.id}`, t.id);
    t.timeline.push({ ts: now(), robotId: 'VOCÊ', text: 'Destravou a task: segue de onde parou' });
    return true;
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
        await git.commentPr(repo, task.pr, `🧪 **QA (${qaId}): voltou para correção** · ${task.tests.passed}/${task.tests.total}\n\n${r.summary}\n\n${task.problems.map((p) => `- ${p}`).join('\n')}`);
        if (stopIfLooping(task, qaId)) return;
        return meeting(task, qaId);
      }
      await git.commentPr(repo, task.pr, `🧪 **QA (${qaId}): aprovado** · ${task.tests.passed}/${task.tests.total}\n\n${r.summary}`);
      // merge pelo PR (o mesmo que clicar em Merge no GitHub); sem PR, como antes, pelo worktree de integração
      if (task.pr?.number) await git.mergePr(repo, task.pr, `Merge #${task.pr.number}: ${shortTitle(task)}`);
      else await git.mergeInto(repo, task.branch, base);
      Object.assign(task, { column: 'merged', mergedAt: now() });
      s.deliveredTotal++;
      const sc = task.screen && s.canvas.screens.find((x) => x.file === task.screen);
      if (sc) { Object.assign(sc, { status: 'entregue', outdated: false }); s.canvas.changes.push({ time: now(), text: `Marcou "${sc.name}" como entregue (${task.id})` }); }
      s.reports.push({
        taskId: task.id, title: task.title, area: task.area, dev: task.dev, qa: qaId, branch: task.branch,
        commits: task.commits.length, tests: task.tests, rework: task.rework, time: now(), cost: task.cost, pr: task.pr || null,
        security: { reviewer: task.secReviewer || 'SEC_01', findings: task.findings.map(({ severity, title }) => ({ severity, title })) },
        summary: `${r.summary} Merge feito em ${base}; vai para ${prod} no próximo release.`,
      });
      state.keep(s.reports, 60);
      s.changelog.push({ time: now(), taskId: task.id, kind: task.origin === 'security' || task.origin === 'ops' ? 'Corrigido' : 'Novo', text: `${task.origin === 'security' || task.origin === 'ops' ? 'Corrigido' : 'Novo'}: ${task.title}` });
      extras.onMerged(task);
      state.step(task, qaId, `Aprovou · merge${task.pr?.number ? ` do PR #${task.pr.number}` : ''} em ${base} · relatório pronto`);
      mergesThisRun++;
      // a pausa do piloto (revise antes da próxima) só vale no modo 1 por 1
      const stopAt = s.mode === 'one' && config.limits?.pauseAfterMerges;
      if (stopAt && mergesThisRun >= stopAt) {
        setPaused(true, `piloto: ${mergesThisRun} entrega(s) em ${base}; revise e continue quando quiser`);
        state.alert('warn', `Piloto concluído: ${task.id} "${task.title}" foi para ${base}. Revise o merge e clique em Continuar.`, { taskId: task.id, panel: 'reports' });
      }
      await project.move(task.itemId, 'done');
      await git.removeWorktree(repo, task.worktree);
      // a branch já está em develop: apaga do remoto e do local para não acumular branch morta
      await git.deleteBranch(repo, task.branch);
      state.step(task, 'OPS_01', `Branch ${task.branch} apagada (remoto e local) · já está em ${base}`);
    });
  }

  // reunião de verdade: com o que falhou, o P.O reescreve os critérios antes da próxima tentativa
  async function meeting(task, reviewerId) {
    if (task.rework < config.meetingAfter || task.aligned || s.meeting) return;
    // pausado não vai para a reunião; sem o P.O não há quem reescreva os critérios, então adia
    const people = ['PO_01', task.dev, reviewerId].filter((id, i, a) => id && s.robots[id] && a.indexOf(id) === i && !s.robots[id].paused);
    if (!people.includes('PO_01')) {
      state.push('OPS_01', `${task.id}: reunião adiada, o P.O está pausado · os critérios seguem os mesmos por enquanto`);
      return;
    }
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
    // já existia no app: não virou entrega do escritório, não entra no release
    const ready = s.board.filter((t) => t.column === 'merged' && !t.released && !t.alreadyDone);
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
      const notes = await extras.releaseNotes(tasks);
      // um PR de release por repositório (web e app podem ser o mesmo monorepo)
      const repos = [...new Map(tasks.map((t) => [repoOf(t).path, repoOf(t)])).values()];
      for (const repo of repos) {
        const list = tasks.filter((t) => repoOf(t).path === repo.path).map((t) => `- ${t.title}${t.pr?.number ? ` (#${t.pr.number})` : ''}`).join('\n');
        const pr = await git.openPr(repo, { head: base, base: prod, title: `Release ${version}`, body: `## Notas\n${notes}\n\n## Entregas\n${list}\n\n---\nAprovado pelo dono no escritório de robôs.` });
        if (pr.number) await git.mergePr(repo, pr, `Release ${version}`);
        else await git.mergeInto(repo, base, prod);
        state.push('OPS_01', `PR de release${pr.number ? ` #${pr.number}` : ''} ${base} → ${prod} mergeado`, { kind: 'release' });
      }
      tasks.forEach((t) => { t.released = version; t.timeline.push({ ts: now(), robotId: 'OPS_01', text: `Foi para produção no ${version}` }); });
      s.releases.push({ version, time: now(), tasks: tasks.map((t) => ({ id: t.id, title: t.title, area: t.area })), notes });
      state.push('OPS_01', `${version} em ${prod} (aprovado por você)`, { kind: 'release' });
    });
  }

  const extras = createExtras({ config, state, agent, work, git, repoOf });
  let mergesThisRun = 0;

  // ── agenda: a cada volta, quem está livre pega o próximo trabalho ──
  let syncing = null;
  let lastSync = 0;
  let lastPlanCheck = 0;
  function schedule() {
    if (Date.now() - lastPlanCheck > (config.plan?.checkSeconds || 60) * 1000) { lastPlanCheck = Date.now(); refreshPlan(); }
    if (s.paused || planWaiting()) return;
    if (s.plan.waitUntil) {
      s.plan.waitUntil = null;
      state.push('OPS_01', 'Plano renovado: os robôs voltaram ao trabalho');
      refreshPlan();
    }
    resumeParked();
    if (Date.now() - lastSync > config.project.syncSeconds * 1000 && !syncing) {
      lastSync = Date.now();
      syncing = syncProject().catch((err) => state.alert('warn', `Não li o GitHub Project: ${err.message}`)).finally(() => (syncing = null));
    }
    const ready = (t) => !t.blocked && !t.parked;
    // correções voltam para o mesmo dev antes de qualquer task nova
    for (const dev of byKind('dev')) {
      if (busy(dev.id)) continue;
      const back = s.board.find((t) => ready(t) && t.column === 'rework' && t.dev === dev.id);
      if (back) develop(back, dev.id);
    }
    // task travada esperando você não ocupa a vaga
    const active = s.board.filter((t) => !t.blocked && ['refining', 'dev', 'security', 'qa', 'rework'].includes(t.column)).length;
    if (!busy('PO_01') && active < maxActive()) {
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

  // ── depois de um reinício (ou de o motor cair), ninguém está trabalhando de verdade: cada task volta
  // para um ponto de onde o fluxo anda sozinho. O que o dev deixou no worktree vira commit e segue para a
  // segurança, sem rodar o dev de novo; sem nada salvo, o dev recomeça.
  function recover() {
    // task parada há mais de 3 dias não mantém worktree e branch para sempre: limpa o órfão;
    // se você destravar depois, o dev recomeça num worktree novo a partir da base
    const stale = Date.now() - 3 * 24 * 3600e3;
    for (const t of s.board) {
      if (!t.blocked || !t.worktree) continue;
      const paradaEm = new Date(t.timeline?.at(-1)?.ts || t.createdAt || 0).getTime();
      if (paradaEm > stale) continue;
      const repo = repoOf(t);
      const dir = t.worktree;
      t.worktree = null;
      state.step(t, 'OPS_01', `Parada há mais de 3 dias: removi o worktree e a branch ${t.branch} · destravar recomeça do zero`);
      git.removeWorktree(repo, dir)
        .then(() => git.deleteBranch(repo, t.branch))
        .catch((err) => log(`limpeza de ${t.id}: ${err.message}`));
    }
    for (const t of s.board) {
      // travada espera você destravar, também depois de um reinício
      if (t.blocked) continue;
      // espera o plano renovar com o mesmo robô
      if (t.parked) {
        const id = t.parked.robotId;
        if (s.robots[id]) state.setRobot(id, { status: 'idle', taskId: t.id, progress: 0, activity: `Esperando o plano renovar${s.plan.waitUntil ? ` (${hhmm(s.plan.waitUntil)})` : ''}` });
        continue;
      }
      if (t.column === 'refining') Object.assign(t, { column: 'todo', dev: null });
      if (t.column === 'security') t.secBy = null;
      if (t.column === 'qa') t.qa = null;
      if (t.column !== 'dev' || !t.dev) continue;
      if (!t.worktree) { t.column = 'todo'; t.dev = null; continue; }
      const type = t.rework || t.origin === 'security' || t.origin === 'ops' ? 'fix' : 'feat';
      work(t.dev, t, 'Retomando depois do reinício', async () => {
        const commits = await git.commitAndPush(t.worktree, t.branch, base, commitMessage(t, type));
        const known = new Set(t.commits.map((c) => c.sha));
        for (const c of commits) if (!known.has(c.sha)) t.commits.push({ ...c, time: now() });
        s.robots[t.dev].commits += commits.length;
        if (commits.length) {
          await publishPr(t, t.dev, 'Trabalho salvo depois de o motor reiniciar.', false);
          t.column = 'security';
          state.step(t, t.dev, `Retomou depois do reinício: salvou o trabalho em ${t.branch} (${commits.length} commit) e mandou para a revisão de segurança`);
        } else {
          state.step(t, t.dev, 'Retomou depois do reinício: não havia nada salvo, recomeça a implementar');
          setTimeout(() => develop(t, t.dev), 0);
        }
      });
    }
  }

  // ── IA dos robôs ──
  async function aiInfo({ refresh = false } = {}) {
    let opencode = [];
    let opencodeError = null;
    try { opencode = await agents.opencodeModels({ refresh }); } catch (err) { opencodeError = err.message; }
    // provider/model: a de Desenvolvimento (o botão do topo e a barra do plano usam)
    return { ...aiFor('main'), slots: s.ai.slots, labels: SLOT_LABEL, claude: CLAUDE_MODELS, opencode, opencodeError };
  }
  // vale para o próximo passo de cada robô; quem está no meio de um termina com a IA de antes.
  // provider 'same' (só Melhorias e Marketing) volta a seguir a de Desenvolvimento
  async function setAi({ slot = 'main', provider, model }) {
    if (!SLOTS.includes(slot)) throw new Error('grupo desconhecido');
    if (provider === 'same' && slot !== 'main') {
      s.ai.slots[slot] = null;
      state.decision(`${SLOT_LABEL[slot]} volta a usar a IA de Desenvolvimento`);
      state.changed();
      return aiInfo();
    }
    if (!['claude', 'opencode'].includes(provider)) throw new Error('IA desconhecida');
    model = String(model || '').trim();
    if (!model) throw new Error('escolha um modelo');
    if (provider === 'opencode') {
      const list = await agents.opencodeModels().catch(() => null);
      if (list && !list.some((m) => m.id === model)) throw new Error(`o OpenCode não tem o modelo ${model} (veja \`opencode models\`)`);
    }
    s.ai.slots[slot] = { provider, model };
    state.decision(`Trocou a IA de ${SLOT_LABEL[slot]} para ${aiLabel(slot)}`);
    state.push('OPS_01', `IA de ${SLOT_LABEL[slot]} agora é ${aiLabel(slot)}`);
    // esperando o plano Claude e o Desenvolvimento saiu do Claude: as tasks paradas seguem já na próxima volta
    if (slot === 'main' && provider !== 'claude' && s.plan.waitUntil) s.plan.waitUntil = null;
    state.changed();
    return aiInfo();
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
    // sugestão aprovada vira item do GitHub Project (e task no board); erro em produção vira correção
    const itemId = await project.create(idea.title, idea.detail);
    const t = addTask({ id: `S-${idea.id}`, itemId, title: idea.title.replace(/^(Implementar|Corrigir erro em produção:|Nova tela:)\s*"?|"$/g, ''), body: idea.detail, area: idea.area || 'web', origin: idea.focus === 'ops' ? 'ops' : 'idea', from: idea.by });
    idea.taskId = t.id;
    if (idea.incident) {
      const inc = s.incidents.find((i) => i.sentryId === idea.incident);
      if (inc) inc.taskId = t.id;
    }
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
    // every: intervalo entre voltas do agenda (2 s no motor; os testes usam um bem menor)
    start({ every = 2000 } = {}) {
      recover();
      syncProject().catch((err) => state.alert('warn', `Não li o GitHub Project: ${err.message}`));
      lastSync = Date.now();
      const timer = setInterval(schedule, every);
      state.push('OPS_01', dryRun ? `Motor ligado em modo de ensaio (sem API, sem git, sem GitHub) · ${aiLabel()}` : `Motor ligado · ${Object.keys(config.repos).join(' e ')} · Project #${config.project.number} · ${aiLabel()}`);
      return () => clearInterval(timer);
    },
    actions: {
      decide,
      unblock: (taskId) => { const ok = unblock(taskId); state.changed(); return ok; },
      setMode(mode) {
        if (!['one', 'all'].includes(mode) || s.mode === mode) return s.mode;
        s.mode = mode;
        state.decision(mode === 'one' ? 'Escritório no modo 1 por 1: uma task por vez' : 'Escritório com todos trabalhando: cada dev livre pega uma task');
        state.push('OPS_01', mode === 'one' ? 'Modo 1 por 1: as próximas tasks começam uma de cada vez (quem já está no meio termina)' : 'Todos trabalhando: cada dev livre pega a próxima task da área dele');
        return s.mode;
      },
      aiInfo,
      setAi,
      setPaused: (v) => setPaused(v),
      adjustIdea: (id, note) => extras.adjust(id, note),
      setRobotPaused(id, v) { if (s.robots[id]) { s.robots[id].paused = v; delete s.robots[id].pausedBy; state.decision(`${v ? 'Pausou' : 'Retomou'} ${id}`); } },
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
