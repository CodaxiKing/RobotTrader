import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { OFFICE, FLOORS, ROBOTS, robotById } from './data/robots.js';
import { createSimulatedFeed } from './data/feed.js';
import { createLiveFeed } from './data/live.js';
import { buildWorld } from './world.js';
import { AREA, fmtTime, pct, doneLabel, drawMonitorWork, drawFullScreen, drawCanvasWall, drawWallChart } from './screens.js';
import { usd } from './data/stats.js';
import { esc } from './ui/html.js';
import { createPanels } from './ui/panels.js';
import { createMinimap } from './ui/minimap.js';

// ── fonte de dados ──  simulada por padrão; ?live=1 lê ./status.json
const params = new URLSearchParams(location.search);
const LIVE = params.get('live') === '1';
// a simulação lembra de tudo (aprovações, prioridade, orçamento) ao recarregar; ?reset=1 recomeça do zero
const SIM_KEY = 'petlive-office-sim';
const simStorage = {
  get() { try { return localStorage.getItem(SIM_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(SIM_KEY, v); } catch { /* sem armazenamento: só não lembra */ } },
  clear() { try { localStorage.removeItem(SIM_KEY); } catch { /* idem */ } },
};
if (params.get('reset') === '1') simStorage.clear();
const feed = LIVE ? createLiveFeed({ url: './status.json', intervalMs: 5000 }) : createSimulatedFeed({ intervalMs: 1400, storage: simStorage });

// ── renderer / câmera isométrica ──
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'css2d';
app.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);

const BASE_H = 40;
const aspect = () => window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(-BASE_H * aspect() / 2, BASE_H * aspect() / 2, BASE_H / 2, -BASE_H / 2, 0.1, 600);
const DIR = new THREE.Vector3(1, 0.85, 1).normalize().multiplyScalar(160);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minZoom = 0.5;
controls.maxZoom = 6;
controls.minPolarAngle = 0.75;
controls.maxPolarAngle = 1.3;
controls.minAzimuthAngle = Math.PI / 4 - 0.55;
controls.maxAzimuthAngle = Math.PI / 4 + 0.55;

// ── luzes ──
const hemi = new THREE.HemisphereLight(0xb4c0f0, 0x3a2e14, 1.5);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff0d6, 2.0);
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, { left: -64, right: 64, top: 50, bottom: -50, near: 1, far: 260 });
key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
key.castShadow = true;
key.position.set(26, 48, 32);
scene.add(key, key.target);

// ── pós-processamento: bloom para o neon ──
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.2, 0.4, 1.0));
composer.addPass(new OutputPass());

// ── mundo ──
const world = buildWorld(scene, FLOORS, ROBOTS, { feed, camera });

// ── vistas ──  o salão inteiro, ou uma zona (time) enquadrada
// Na isométrica, largura e profundidade do trecho entram juntas na largura da tela.
function viewFor(fid) {
  const a = aspect();
  const zone = fid && world.zone(fid);
  // uma zona ocupa a profundidade da sua ala (22); o salão todo, as duas alas
  const span = zone ? zone.w + 4 + 22 : (world.FX + world.FZ) * 2;
  const h = Math.max(span * 0.53 + (zone ? 8 : 10), (span * 0.92) / a);
  return { target: new THREE.Vector3(zone ? zone.x : 0, 1.0, zone ? zone.oz + 1.2 : 1.2), zoom: BASE_H / h };
}
let currentFloor = FLOORS.some((f) => f.id === params.get('floor')) ? params.get('floor') : null;
let HOME = viewFor(currentFloor);

function applyView(v) {
  controls.target.copy(v.target);
  camera.position.copy(v.target).add(DIR);
  camera.zoom = v.zoom;
  camera.updateProjectionMatrix();
  controls.update();
}

let tween = null;
function flyTo(v, ms = 900) {
  const off = camera.position.clone().sub(controls.target);
  tween = { fromT: controls.target.clone(), toT: v.target.clone(), fromZ: camera.zoom, toZ: v.zoom, off, t0: performance.now(), ms };
}
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ── UI ──
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ } },
};
$('title').textContent = OFFICE.title;
$('subtitle').textContent = OFFICE.subtitle;

const sidebar = $('sidebar');
const cards = new Map();
for (const f of [...FLOORS]) {
  const h = document.createElement('div');
  h.className = 'floor-head'; h.textContent = `${f.label} · ${f.name}`;
  h.addEventListener('click', () => selectFloor(f.id));
  sidebar.appendChild(h);
  for (const r of ROBOTS.filter((x) => x.floor === f.id)) {
    const el = document.createElement('div');
    el.className = 'robot-card';
    el.style.setProperty('--c', r.color);
    el.innerHTML = `<div class="row"><span class="name">${r.name}</span><span class="task"></span></div><div class="row sub"><span class="info"></span><span class="pill"></span></div>`;
    el.addEventListener('click', () => focusRobot(r.id));
    sidebar.appendChild(el);
    cards.set(r.id, el);
  }
}

const floorBar = $('floorbar');
const floorBtns = new Map();
for (const f of [{ id: null, label: 'ALL', name: 'Escritório', sub: 'Todos os times' }, ...FLOORS]) {
  const b = document.createElement('button');
  b.innerHTML = `<b>${f.label === 'ALL' ? '▦' : f.label}</b><span><strong>${f.name}</strong><small>${f.sub}</small></span>`;
  b.addEventListener('click', () => selectFloor(f.id));
  floorBar.appendChild(b);
  floorBtns.set(f.id, b);
}

function selectFloor(fid, { fly = true } = {}) {
  currentFloor = fid;
  world.setFloor(fid);
  HOME = viewFor(fid);
  floorBtns.forEach((b, k) => b.classList.toggle('on', k === fid));
  document.body.dataset.floor = fid || 'all';
  const u = new URL(location.href);
  u.searchParams.set('floor', fid || 'all');
  history.replaceState(null, '', u);
  if (fly) { clearFocus(false); flyTo(HOME); }
}

// ── topo: entregas, pipeline, contadores, orçamento, pausa ──
const taskOf = (s) => (s.taskId ? feed.task(s.taskId) : null);
const STATUS_LABEL = { working: 'trabalhando', meeting: 'em reunião', idle: 'livre' };
const statusPill = (pill, s) => {
  const k = s.paused || feed.paused ? 'paused' : s.status;
  pill.className = `pill ${k}`;
  pill.textContent = k === 'paused' ? 'pausado' : STATUS_LABEL[s.status] || s.status;
};
const pendingCount = () => feed.ideas.filter((i) => i.status === 'aguardando').length;

const pipeline = $('pipeline');
function renderSummary() {
  const busy = ROBOTS.filter((r) => ['working', 'meeting'].includes(feed.getState(r.id).status)).length;
  $('count-working').textContent = busy;
  $('count-idle').textContent = ROBOTS.length - busy;
  $('total-value').textContent = String(feed.delivered.at(-1) ?? 0);
  const count = (...cols) => feed.board.filter((t) => cols.includes(t.column)).length;
  pipeline.innerHTML = [['Backlog', count('todo', 'refining')], ['Dev', count('dev', 'rework')], ['Segurança', count('security')], ['QA', count('qa')]]
    .map(([k, n]) => `<span class="chip"><b>${n}</b> ${k}</span>`).join('<i class="arrow">→</i>');
  const pending = pendingCount();
  for (const id of ['ideas-badge', 'm-badge']) {
    const badge = $(id);
    badge.hidden = !pending;
    badge.textContent = pending;
  }
  $('ideas-badge').title = `${pending} item(ns) esperando a sua decisão`;
  $('m-approvals').hidden = !pending;
  // orçamento
  const spent = feed.spend?.today || 0;
  const budget = feed.budget || OFFICE.dailyBudgetUsd;
  const ratio = Math.min(1, spent / budget);
  $('budget-label').textContent = `${usd(spent)} / ${budget}`;
  $('budget-fill').style.width = `${ratio * 100}%`;
  $('budget').classList.toggle('warn', ratio >= 0.8);
  // plano Claude
  const waiting = renderPlan(feed.plan);
  // pausa (a espera do plano aparece na mesma faixa, mas volta sozinha: sem botão de continuar)
  $('btn-pause').textContent = feed.paused ? '▶ Continuar' : '⏸ Pausar';
  $('btn-pause').classList.toggle('on', !!feed.paused);
  $('paused-banner').hidden = !feed.paused && !waiting;
  $('paused-text').textContent = feed.paused
    ? `Escritório pausado: ${feed.pauseReason || 'pausado por você'}.`
    : waiting ? `Limite do plano Claude acabou. As tasks ficam paradas com o mesmo robô e continuam sozinhas ${whenText(feed.plan.waitUntil)}.` : '';
  $('paused-resume').hidden = !feed.paused;
  $('paused-budget').hidden = !feed.paused || !/orçamento/.test(feed.pauseReason || '');
  document.body.classList.toggle('is-paused', !!feed.paused || waiting);
}

// "às 15:00", ou "sáb às 04:00" quando não é hoje
const whenText = (ms) => {
  if (!ms) return 'quando o plano renovar';
  const d = new Date(ms);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `às ${time}` : `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} às ${time}`;
};
// barra do plano: o que resta da janela de 5h e da semana; devolve se os robôs estão esperando a renovação
function renderPlan(plan) {
  const chip = $('plan');
  const show = !!plan?.available && (feed.ai?.provider || 'claude') === 'claude';
  chip.hidden = !show;
  if (!show) return false;
  const left = (w) => (w ? Math.max(0, 100 - Math.round(w.used)) : null);
  const session = left(plan.session);
  const weekly = left(plan.weekly);
  const lowest = Math.min(...[session, weekly].filter((v) => v != null));
  const waiting = !!plan.waitUntil && plan.waitUntil > Date.now();
  $('plan-label').textContent = waiting ? `Plano esgotado · volta ${whenText(plan.waitUntil).replace(/^às /, '')}` : `Plano ${plan.name || ''} · resta ${lowest}%`.replace('  ', ' ');
  $('plan-session').style.width = `${session ?? 0}%`;
  $('plan-weekly').style.width = `${weekly ?? 0}%`;
  chip.classList.toggle('out', waiting || lowest <= 0);
  chip.classList.toggle('warn', !waiting && lowest > 0 && lowest <= 20);
  const line = (name, w, l) => (w ? `${name}: ${Math.round(w.used)}% usado, resta ${l}% · renova ${whenText(w.resetsAt)}` : `${name}: sem dado`);
  chip.title = [`Plano Claude dos robôs${plan.name ? ` (${plan.name})` : ''}`, line('Janela de 5h (barra de cima)', plan.session, session), line('Semana (barra de baixo)', plan.weekly, weekly),
    waiting ? `Esgotado: os robôs continuam sozinhos ${whenText(plan.waitUntil)}.` : 'Se acabar no meio de uma task, o robô espera e continua sozinho na renovação.'].join('\n');
  return waiting;
}
$('plan').onclick = () => { openPanel('account'); refreshAccount(); };
$('btn-pause').onclick = () => feed.setPaused(!feed.paused);
$('paused-resume').onclick = () => feed.setPaused(false);
$('paused-budget').onclick = () => feed.setBudget((feed.budget || OFFICE.dailyBudgetUsd) + 10);
$('budget').onclick = () => openPanel('metrics');

function renderCards() {
  for (const r of ROBOTS) {
    const s = feed.getState(r.id);
    const t = taskOf(s);
    const el = cards.get(r.id);
    const task = el.querySelector('.task');
    task.textContent = t ? `${t.id} · ${s.status === 'meeting' ? 'reunião' : pct(s.progress)}` : '';
    task.style.color = t ? AREA[t.area].color : '';
    el.querySelector('.info').textContent = s.activity;
    statusPill(el.querySelector('.pill'), s);
  }
}

// ── cartão do robô: estado, pausa individual e conversa ──
const info = $('infocard');
const chats = new Map(); // robô → [{ who: 'você' | robô, text }]
let selected = null;
let infoFor = null;
// a estrutura é montada uma vez por robô; as atualizações só trocam os valores (não recria os botões)
function buildInfo(id) {
  const r = robotById(id);
  const f = FLOORS.find((x) => x.id === r.floor);
  infoFor = id;
  info.style.setProperty('--c', r.color);
  info.innerHTML = `
    <button class="close" title="Fechar">×</button>
    <h3>${esc(r.name)} <span class="pill" data-k="pill" style="margin-left:auto"></span></h3>
    <div class="role">${esc(r.roleLabel)} · ${esc(f.name)}</div>
    <div class="big" data-k="big"></div>
    <div class="kv">
      <span>Atividade</span><span data-k="activity"></span>
      <span>Progresso</span><span data-k="progress"></span>
      <span>Branch</span><span data-k="branch"></span>
      <span>Commits da task</span><span data-k="commits"></span>
      <span data-k="doneLabel"></span><span data-k="done"></span>
      <span>Gasto</span><span data-k="cost"></span>
    </div>
    <canvas width="300" height="150"></canvas>
    <div class="info-actions">
      <button data-k="pause"></button>
      <button data-k="timeline">Linha do tempo da task</button>
    </div>
    <div class="label">Atividade recente</div>
    <ul data-k="events"></ul>
    <div class="label">Conversar com ${esc(r.name)}</div>
    <div class="chat" data-k="chat"></div>
    <form class="chat-form"><input name="q" autocomplete="off" placeholder="o que está fazendo? por que devolveu? prioriza #123" /><button>Enviar</button></form>
    <button class="open-screen">Abrir tela ▦</button>`;
  info.querySelector('.close').onclick = () => clearFocus();
  info.querySelector('.open-screen').onclick = () => openScreen(id);
  info.querySelector('[data-k="pause"]').onclick = () => feed.setRobotPaused(id, !feed.getState(id).paused);
  info.querySelector('[data-k="timeline"]').onclick = () => { const t = taskOf(feed.getState(id)); if (t) openTask(t.id); };
  info.querySelector('.chat-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = e.target.elements.q;
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    const log = chats.get(id) || [];
    chats.set(id, log);
    log.push({ who: 'você', text: q });
    renderChat(id);
    try { log.push({ who: id, text: await feed.ask(id, q) }); } catch (err) { log.push({ who: id, text: `Não consegui responder: ${err.message || err}` }); }
    renderChat(id);
  };
  renderChat(id);
}
function renderChat(id) {
  const box = info.querySelector('[data-k="chat"]');
  if (!box || infoFor !== id) return;
  const log = chats.get(id) || [];
  box.innerHTML = log.length
    ? log.slice(-8).map((m) => `<p class="${m.who === 'você' ? 'me' : 'bot'}"><b>${esc(m.who)}</b> ${esc(m.text)}</p>`).join('')
    : '<p class="hint">Pergunte o que ele está fazendo, por que devolveu uma task, quanto gastou, ou mande priorizar uma task (#123), pausar ou continuar.</p>';
  box.scrollTop = box.scrollHeight;
}
function renderInfo(id) {
  if (infoFor !== id) buildInfo(id);
  const r = robotById(id);
  const s = feed.getState(id);
  const t = taskOf(s);
  const set = (k, text, color) => { const el = info.querySelector(`[data-k="${k}"]`); el.textContent = text; el.style.color = color || ''; };
  statusPill(info.querySelector('[data-k="pill"]'), s);
  set('big', t ? `${t.id} · ${t.title}` : s.status === 'working' ? s.activity : 'Sem task no momento', t ? AREA[t.area].color : '');
  set('activity', s.activity);
  set('progress', s.status === 'working' ? pct(s.progress) : '—');
  set('branch', t?.branch || '—');
  set('commits', t ? String(t.commits.length) : '—');
  set('doneLabel', doneLabel(r).replace(/^./, (c) => c.toUpperCase()));
  set('done', String(s.done));
  set('cost', usd(s.cost));
  set('pause', s.paused ? '▶ Continuar este robô' : '⏸ Pausar este robô');
  info.querySelector('[data-k="timeline"]').disabled = !t;
  const ul = info.querySelector('[data-k="events"]');
  const recent = feed.history.filter((e) => e.robotId === id).slice(-5).reverse();
  ul.replaceChildren(...(recent.length ? recent : [null]).map((e) => {
    const li = document.createElement('li');
    if (e) { const tm = document.createElement('time'); tm.textContent = fmtTime(e.ts); li.append(tm, e.message); } else li.textContent = 'Sem atividade ainda';
    return li;
  }));
  const cv = info.querySelector('canvas');
  drawMonitorWork(cv.getContext('2d'), cv.width, cv.height, { s, robot: r, task: t, board: feed.board, canvas: feed.canvas });
}

function focusRobot(id) {
  const a = world.actors.get(id);
  selected = id;
  cards.forEach((el, k) => el.classList.toggle('selected', k === id));
  const p = a.pos.clone(); p.y += 1.4;
  flyTo({ target: p, zoom: Math.max(HOME.zoom * 2.2, BASE_H / 12) });
  renderInfo(id);
  info.classList.remove('hidden');
}
function clearFocus(fly = true) {
  selected = null;
  infoFor = null;
  cards.forEach((el) => el.classList.remove('selected'));
  info.classList.add('hidden');
  if (fly) flyTo(HOME);
}

// ── overlay: painéis da interface ──
const overlay = $('overlay');
const ovBody = overlay.querySelector('.ov-body');
const ovTitle = overlay.querySelector('.ov-title');
let overlayState = null; // { kind, id?, html? }
let dragging = null;     // task sendo arrastada no Backlog: não redesenha o board no meio do arraste
const screenView = (id) => {
  const s = feed.getState(id);
  return { s, robot: robotById(id), task: taskOf(s), board: feed.board, canvas: feed.canvas, events: feed.history.filter((e) => e.robotId === id) };
};
// conta Claude que o motor usa (só existe com o motor no ar)
let accountInfo = null;
const { PANELS, taskHtml, pieceHtml } = createPanels({ feed, root: () => ovBody, account: () => accountInfo, live: LIVE });

ovBody.addEventListener('click', async (e) => {
  // link (PR, canvas) abre no GitHub sem disparar o clique do card
  if (e.target.closest('a[href]')) return;
  const open = e.target.closest('[data-open]');
  if (open) return openPanel(open.dataset.open, { toggle: false });
  if (e.target.closest('[data-acc-login]')) {
    const email = ovBody.querySelector('[data-acc-email]')?.value.trim();
    await accountCall('login', { email });
    return;
  }
  if (e.target.closest('[data-acc-send]')) {
    const code = ovBody.querySelector('[data-acc-code]')?.value.trim();
    if (code) await accountCall('code', { code });
    return;
  }
  if (e.target.closest('[data-ai-toggle]')) return aiMenu(ovBody.querySelector('[data-ai-menu]')?.hidden);
  const option = e.target.closest('[data-ai-option]');
  if (option) {
    aiMenu(false);
    await aiCall({ provider: option.dataset.provider, model: option.dataset.aiOption });
    return;
  }
  if (e.target.closest('[data-ai-refresh]')) {
    ovBody.querySelector('[data-ai-list]').innerHTML = '<p class="ai-empty">Atualizando a lista do OpenCode…</p>';
    await aiCall({ refresh: true });
    renderAiList();
    return;
  }
  if (e.target.closest('[data-acc-logout]')) {
    if (window.confirm('Desconectar essa conta? Os robôs voltam a usar o login do Claude Code desta máquina.')) await accountCall('logout');
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copiado ✔'; } catch { copy.textContent = 'Não deu para copiar'; }
    return;
  }
  const unblock = e.target.closest('[data-unblock]');
  if (unblock) {
    unblock.disabled = true;
    await feed.unblock(unblock.dataset.unblock);
    return;
  }
  if (e.target.closest('[data-reset]')) {
    if (window.confirm('Apagar a simulação guardada e recomeçar do zero?')) { feed.reset(); location.search = ''; }
    return;
  }
  const budget = e.target.closest('[data-budget]');
  if (budget) return feed.setBudget((feed.budget || OFFICE.dailyBudgetUsd) + Number(budget.dataset.budget));
  const adjust = e.target.closest('[data-adjust]');
  if (adjust) {
    const note = window.prompt('O que a agência deve ajustar? (ex.: legenda mais curta, outro gancho, trocar a foto)');
    if (note !== null) feed.adjustIdea?.(adjust.dataset.adjust, note.trim());
    return;
  }
  const b = e.target.closest('[data-approve], [data-reject]');
  if (b) return b.dataset.approve ? feed.approveIdea(b.dataset.approve) : feed.rejectIdea(b.dataset.reject);
  const piece = e.target.closest('[data-piece]');
  if (piece && overlayState?.kind !== 'piece') return openPiece(piece.dataset.piece);
  const card = e.target.closest('[data-task]');
  if (card && overlayState?.kind !== 'task') openTask(card.dataset.task);
});
ovBody.addEventListener('input', (e) => { if (e.target.matches('[data-audit-q], [data-audit-kind]')) { overlayState.html = null; drawOverlay(); } });
ovBody.addEventListener('change', (e) => { if (e.target.matches('[data-audit-kind]')) { overlayState.html = null; drawOverlay(); } });

// arrastar no Backlog muda a prioridade
ovBody.addEventListener('dragstart', (e) => {
  const card = e.target.closest('[data-task][draggable]');
  if (!card) return;
  dragging = card.dataset.task;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
ovBody.addEventListener('dragover', (e) => {
  if (!dragging || !e.target.closest('[data-col="todo"]')) return;
  e.preventDefault();
  ovBody.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before'));
  e.target.closest('[data-task][draggable]')?.classList.add('drop-before');
});
ovBody.addEventListener('drop', (e) => {
  if (!dragging) return;
  e.preventDefault();
  const before = e.target.closest('[data-task][draggable]')?.dataset.task;
  const id = dragging;
  dragging = null;
  if (before !== id) feed.prioritize(id, before || null);
  overlayState.html = null;
  drawOverlay();
});
ovBody.addEventListener('dragend', () => { dragging = null; if (overlayState) { overlayState.html = null; drawOverlay(); } });

function drawOverlay() {
  if (!overlayState) return;
  const { kind } = overlayState;
  const panel = PANELS[kind];
  if (panel || kind === 'task' || kind === 'piece') {
    if (dragging) return;
    if (panel?.shell && !overlayState.shell) { ovBody.innerHTML = panel.shell(); overlayState.shell = true; }
    const target = panel?.shell ? ovBody.querySelector('[data-body]') : ovBody;
    // só reescreve quando muda: recriar os botões a cada atualização engoliria o clique
    const html = kind === 'task' ? taskHtml(overlayState.id) : kind === 'piece' ? pieceHtml(overlayState.id) : panel.html();
    if (html !== overlayState.html) {
      overlayState.html = html;
      const top = ovBody.scrollTop;
      target.innerHTML = html;
      ovBody.scrollTop = top;
    }
    const map = ovBody.querySelector('canvas.canvas-map');
    if (map && feed.canvas) drawCanvasWall(map.getContext('2d'), map.width, map.height, feed.canvas);
    const chart = ovBody.querySelector('canvas.spend-chart');
    if (chart) drawWallChart(chart.getContext('2d'), chart.width, chart.height, feed.spend?.series || [], 'GASTO DO DIA (US$)');
  } else if (kind === 'wall') {
    const p = world.panel(overlayState.id);
    const cv = ovBody.querySelector('canvas');
    if (cv) p.draw(cv.getContext('2d'), cv.width, cv.height);
  } else if (kind === 'one') {
    const cv = ovBody.querySelector('canvas');
    if (cv) drawFullScreen(cv.getContext('2d'), cv.width, cv.height, screenView(overlayState.id));
  } else {
    ovBody.querySelectorAll('canvas').forEach((cv) => drawFullScreen(cv.getContext('2d'), cv.width, cv.height, screenView(cv.dataset.id)));
  }
}
function showOverlay(state, title, html = null) {
  overlayState = state;
  ovTitle.textContent = title;
  if (html !== null) ovBody.innerHTML = html;
  ovBody.scrollTop = 0;
  overlay.classList.remove('hidden');
  drawOverlay();
  syncViewBtns();
}
function openPanel(kind, { toggle = true } = {}) {
  if (toggle && overlayState?.kind === kind) return closeOverlay();
  showOverlay({ kind }, PANELS[kind].title, '');
}
function openTask(id) { showOverlay({ kind: 'task', id }, `Linha do tempo · ${id}`, ''); }
function openPiece(id) { showOverlay({ kind: 'piece', id }, `Criativo · ${id}`, ''); }
function openScreen(id) { showOverlay({ kind: 'one', id }, `Tela · ${id}`, '<canvas width="1120" height="630"></canvas>'); }
function openGrid() {
  if (overlayState?.kind === 'grid') return closeOverlay();
  showOverlay({ kind: 'grid' }, 'Telas de todos os robôs',
    FLOORS.map((f) => `<div class="ov-floor">${f.label} · ${esc(f.name)}</div><div class="ov-grid">${ROBOTS.filter((r) => r.floor === f.id).map((r) => `<canvas width="480" height="270" data-id="${r.id}"></canvas>`).join('')}</div>`).join(''));
  ovBody.querySelectorAll('canvas').forEach((cv) => cv.addEventListener('click', () => openScreen(cv.dataset.id)));
}
// painel de parede clicado: abre o painel da interface ligado a ele, ou ele mesmo ampliado
function openWall(id) {
  const p = world.panel(id);
  if (!p) return;
  if (p.open) return openPanel(p.open, { toggle: false });
  showOverlay({ kind: 'wall', id }, p.title, '<canvas width="1120" height="630"></canvas>');
}
function closeOverlay() { overlayState = null; overlay.classList.add('hidden'); syncViewBtns(); }
const viewBtns = {
  board: $('btn-board'), canvas: $('btn-canvas'), ideas: $('btn-ideas'), marketing: $('btn-marketing'), reports: $('btn-reports'), releases: $('btn-releases'),
  today: $('btn-today'), metrics: $('btn-metrics'), audit: $('btn-audit'), grid: $('btn-screens'),
};
function syncViewBtns() { for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle('on', overlayState?.kind === k); }
overlay.querySelector('.ov-close').onclick = closeOverlay;
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
$('btn-screens').onclick = openGrid;
for (const k of ['board', 'canvas', 'ideas', 'marketing', 'reports', 'releases', 'today', 'metrics', 'audit']) viewBtns[k].onclick = () => openPanel(k);
$('m-approvals').onclick = () => openPanel('ideas', { toggle: false });
// lista lateral recolhível (começa fechada em telas estreitas para não cobrir o salão)
const toggleSide = (open) => { sidebar.style.display = open ? '' : 'none'; $('btn-list').classList.toggle('on', open); };
$('btn-list').onclick = () => toggleSide(sidebar.style.display === 'none');
toggleSide(window.innerWidth >= 1280);

// ── avisos: toast na tela e notificação do navegador ──
const toasts = $('toasts');
let lastAlert = feed.alerts?.at(-1)?.id || 0;
let notifyOn = store.get('petlive-notify') === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
const renderNotifyBtn = () => { $('btn-notify').classList.toggle('on', notifyOn); $('btn-notify').title = notifyOn ? 'Avisos do navegador ligados' : 'Ligar avisos do navegador'; };
renderNotifyBtn();
$('btn-notify').onclick = async () => {
  if (typeof Notification === 'undefined') return toast({ level: 'warn', text: 'Este navegador não tem notificações.' });
  if (notifyOn) notifyOn = false;
  else notifyOn = (await Notification.requestPermission()) === 'granted';
  store.set('petlive-notify', notifyOn ? '1' : '0');
  renderNotifyBtn();
  toast({ level: 'info', text: notifyOn ? 'Avisos ligados: aprovações, falhas altas, erros em produção e orçamento.' : 'Avisos do navegador desligados.' });
};
function toast(a) {
  const el = document.createElement('button');
  el.className = `toast ${a.level}`;
  el.innerHTML = `<b>${a.level === 'danger' ? '⚠' : a.level === 'warn' ? '!' : '✦'}</b><span>${esc(a.text)}</span>`;
  el.onclick = () => { el.remove(); if (a.taskId && a.panel === 'board') openTask(a.taskId); else if (a.panel) openPanel(a.panel, { toggle: false }); };
  toasts.prepend(el);
  while (toasts.children.length > 4) toasts.lastChild.remove();
  setTimeout(() => el.remove(), a.level === 'danger' ? 15000 : 8000);
}
function renderAlerts() {
  const fresh = (feed.alerts || []).filter((a) => a.id > lastAlert);
  if (!fresh.length) return;
  lastAlert = fresh.at(-1).id;
  // aviso de sugestão vira um só, para não encher a tela
  const ideasN = fresh.filter((a) => a.panel === 'ideas').length;
  const rest = fresh.filter((a) => a.panel !== 'ideas');
  if (ideasN) rest.push({ level: 'info', panel: 'ideas', text: ideasN === 1 ? fresh.find((a) => a.panel === 'ideas').text : `${ideasN} novos itens esperando a sua decisão` });
  for (const a of rest.slice(-3)) {
    toast(a);
    if (notifyOn && (document.hidden || a.level !== 'info')) {
      try { new Notification(`PetLive · ${a.level === 'danger' ? 'atenção' : 'escritório'}`, { body: a.text, tag: `petlive-${a.panel || a.id}` }); } catch { /* sem suporte */ }
    }
  }
}

// ── modo TV: passa pelas zonas sozinho; a cada volta mostra o resumo do dia ──
const TV_STOPS = [null, ...FLOORS.map((f) => f.id), 'today', 'marketing'];
let tv = null;
function setTv(on) {
  document.body.classList.toggle('tv', on);
  $('btn-tv').classList.toggle('on', on);
  $('btn-tv').textContent = on ? '■ Sair da TV' : '▶ TV';
  clearInterval(tv?.timer);
  tv = on ? { i: 0, timer: setInterval(tvNext, 10000) } : null;
  if (on) { toggleSide(false); clearFocus(false); tvNext(); }
  else closeOverlay();
}
function tvNext() {
  const stop = TV_STOPS[tv.i++ % TV_STOPS.length];
  if (stop === 'today' || stop === 'marketing') return openPanel(stop, { toggle: false });
  closeOverlay();
  selectFloor(stop);
}
$('btn-tv').onclick = () => setTv(!tv);

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'Escape') { if (tv) setTv(false); else if (overlayState) closeOverlay(); else clearFocus(); }
  if (e.key === 'r' || e.key === 'R') clearFocus();
});

// ── seleção por clique no 3D ──
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const visibleObj = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const pick = (e) => {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(world.hits.filter(visibleObj), false)[0];
};
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const hit = pick(e);
  if (!hit) return;
  if (hit.object.userData.panel) openWall(hit.object.userData.panel);
  else focusRobot(hit.object.userData.robotId);
});
renderer.domElement.addEventListener('pointermove', (e) => { renderer.domElement.style.cursor = pick(e) ? 'pointer' : ''; });
labelRenderer.domElement.addEventListener('click', (e) => {
  const b = e.target.closest('.bubble');
  if (b) focusRobot(b.dataset.robot);
});

// ── ligação com o feed ──
function refreshAll() {
  world.sync();
  renderSummary();
  renderCards();
  renderAlerts();
  if (selected) renderInfo(selected);
  drawOverlay();
}
feed.subscribe((evt) => {
  if (evt.type === 'heartbeat' || evt.type === 'error') return renderLive();
  refreshAll();
  renderLive();
});
feed.start();

const STALE_MS = 3 * 60 * 1000;
const liveChip = $('live-chip');
const hhmm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function renderLive() {
  let text, cls = 'live';
  if (!LIVE) text = 'simulado';
  else if (!feed.updatedAt) { text = feed.error ? 'sem dados (status.json)' : 'conectando…'; cls = 'stale'; }
  else if (Date.now() - feed.updatedAt.getTime() > STALE_MS) { text = `desatualizado · ${hhmm(feed.updatedAt)}`; cls = 'stale'; }
  else text = `ao vivo · ${hhmm(feed.updatedAt)}`;
  $('live-label').textContent = text;
  liveChip.className = `chip ${cls}`;
}

const tickClock = () => {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('pt-BR');
  world.tickClock(now);
  renderLive();
};
setInterval(tickClock, 1000);

// ── resize + loop ──
window.addEventListener('resize', () => {
  const a = aspect();
  camera.left = -BASE_H * a / 2; camera.right = BASE_H * a / 2; camera.top = BASE_H / 2; camera.bottom = -BASE_H / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  HOME = viewFor(currentFloor);
});

const t0 = performance.now();
let last = t0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (tween) {
    const k = Math.min(1, (now - tween.t0) / tween.ms);
    const e = ease(k);
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.copy(controls.target).add(tween.off);
    camera.zoom = THREE.MathUtils.lerp(tween.fromZ, tween.toZ, e);
    camera.updateProjectionMatrix();
    if (k >= 1) tween = null;
  }
  controls.update();
  world.update((now - t0) / 1000, dt);
  composer.render();
  labelRenderer.render(scene, camera);
});

// ── início ──
// ── mapa pequeno e tema ──
const minimap = createMinimap($('minimap'), { plan: world.plan, actors: world.actors, getState: (id) => feed.getState(id), onPick: (id) => selectFloor(id) });
let theme = (params.get('theme') || store.get('petlive-theme')) === 'light' ? 'light' : 'dark';
function applyTheme(name) {
  theme = name;
  const light = name === 'light';
  document.body.classList.toggle('light', light);
  world.setTheme(name);
  scene.background.set(light ? 0xdfe3ec : 0x04050a);
  hemi.intensity = light ? 2.2 : 1.5;
  renderer.toneMappingExposure = light ? 1.0 : 1.15;
  $('btn-theme').textContent = light ? '☾' : '☀';
  $('btn-theme').title = light ? 'Voltar ao tema escuro' : 'Tema claro';
  store.set('petlive-theme', name);
  minimap.draw(currentFloor, light);
}
$('btn-theme').onclick = () => applyTheme(theme === 'light' ? 'dark' : 'light');

// ── conta Claude dos robôs: selo no topo e painel para conectar outra conta ──
async function refreshAccount() {
  if (!LIVE) return;
  try {
    const res = await fetch('./api/account', { cache: 'no-store' });
    accountInfo = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
  } catch (err) { accountInfo = { error: err.message }; }
  const a = accountInfo;
  const opencode = a?.ai?.provider === 'opencode';
  $('account-label').textContent = a?.error ? 'motor fora do ar'
    : opencode ? aiCurrent(a.ai)?.name || a.ai.model.split('/').pop()
      : a?.email || (a?.using === 'maquina' ? 'esta máquina' : a?.using === 'apiKey' ? 'chave de API' : 'token');
  $('btn-account').title = a?.ai ? `IA dos robôs: ${opencode ? 'OpenCode' : 'Claude'} · ${a.ai.model}` : 'IA e conta que os robôs usam';
  $('btn-account').classList.toggle('warn', !opencode && a?.using === 'maquina');
  if (overlayState?.kind === 'account') { overlayState.html = null; drawOverlay(); syncAiPicker(); }
  // enquanto você autoriza no navegador, confere a cada 2 s
  if (a?.login?.waiting) setTimeout(refreshAccount, 2000);
}
// seletor de IA do painel, no jeito do OpenCode: botão com o modelo atual e menu com busca, por provedor
const aiModels = (ai) => [...(ai?.claude || []), ...(ai?.opencode || [])];
const aiCurrent = (ai) => aiModels(ai).find((m) => m.id === ai.model && (m.provider === 'claude') === (ai.provider === 'claude'));
function syncAiPicker() {
  const ai = accountInfo?.ai;
  const box = ovBody.querySelector('[data-ai-pick]');
  if (!ai || !box) return;
  const m = aiCurrent(ai);
  box.querySelector('[data-ai-name]').textContent = m?.name || ai.model;
  box.querySelector('[data-ai-toggle]').title = `${ai.provider === 'claude' ? 'Claude' : 'OpenCode'} · ${ai.model}`;
  if (!box.querySelector('[data-ai-menu]').hidden) renderAiList();
}
const aiBadge = (m) => (m.plan ? '<em class="plan">Plano</em>' : m.free ? '<em>Grátis</em>'
  : m.price ? `<em class="paid" title="US$ por milhão de tokens: entrada / saída">$${m.price.input} / $${m.price.output}</em>` : '');
function renderAiList() {
  const ai = accountInfo?.ai;
  const list = ovBody.querySelector('[data-ai-list]');
  if (!ai || !list) return;
  const q = (ovBody.querySelector('[data-ai-q]')?.value || '').trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  // "grátis" ou "free" na busca também pega os modelos sem custo
  const hit = (m) => words.every((w) => `${m.name} ${m.id} ${m.providerName} ${m.free ? 'grátis gratis free' : ''}`.toLowerCase().includes(w));
  const current = aiCurrent(ai);
  const groups = new Map();
  for (const m of aiModels(ai).filter(hit)) {
    if (!groups.has(m.providerName)) groups.set(m.providerName, []);
    groups.get(m.providerName).push(m);
  }
  const order = (g) => (g.startsWith('Claude') ? 0 : g === 'OpenCode' ? 1 : 2);
  list.innerHTML = [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)).map(([g, ms]) => `
    <div class="ai-group">${esc(g)}</div>
    ${ms.sort((a, b) => a.name.localeCompare(b.name)).map((m) => `
      <button class="ai-option${m === current ? ' on' : ''}" role="option" data-ai-option="${esc(m.id)}" data-provider="${m.provider === 'claude' ? 'claude' : 'opencode'}" title="${esc(m.id)}${m.context ? ` · contexto ${Math.round(m.context / 1000)}k` : ''}">
        <span>${esc(m.name)}</span>${aiBadge(m)}${m === current ? '<i>✓</i>' : ''}
      </button>`).join('')}`).join('')
    || `<p class="ai-empty">${ai.opencodeError ? esc(ai.opencodeError) : 'Nenhum modelo com esse nome.'}</p>`;
  list.querySelector('.ai-option')?.classList.add('active');
}
function aiMenu(open) {
  const menu = ovBody.querySelector('[data-ai-menu]');
  if (!menu) return;
  menu.hidden = !open;
  ovBody.querySelector('[data-ai-toggle]').setAttribute('aria-expanded', String(!!open));
  if (!open) return;
  const q = ovBody.querySelector('[data-ai-q]');
  q.value = '';
  renderAiList();
  ovBody.querySelector('.ai-option.on')?.scrollIntoView({ block: 'nearest' });
  q.focus();
}
ovBody.addEventListener('input', (e) => { if (e.target.matches('[data-ai-q]')) renderAiList(); });
ovBody.addEventListener('keydown', (e) => {
  if (!e.target.matches('[data-ai-q]')) return;
  const opts = [...ovBody.querySelectorAll('.ai-option')];
  const i = opts.findIndex((o) => o.classList.contains('active'));
  if (e.key === 'Escape') { e.stopPropagation(); aiMenu(false); return; }
  if (e.key === 'Enter') { opts[i]?.click(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const next = opts[Math.min(opts.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  opts.forEach((o) => o.classList.toggle('active', o === next));
  next?.scrollIntoView({ block: 'nearest' });
});
// clicar fora do menu fecha
document.addEventListener('click', (e) => { if (!e.target.closest('[data-ai-pick]')) aiMenu(false); });
async function aiCall(body) {
  try {
    const res = await fetch('./api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    if (accountInfo) accountInfo.ai = out;
    if (!body.refresh) toast({ level: 'info', text: `IA dos robôs: ${aiCurrent(out)?.name || out.model}${out.provider === 'claude' ? ' (Claude)' : ' (OpenCode)'}. Vale a partir do próximo passo de cada robô.` });
  } catch (err) {
    toast({ level: 'danger', text: `Não troquei a IA: ${err.message}` });
  }
  refreshAccount();
}
async function accountCall(action, body = {}) {
  try {
    const res = await fetch(`./api/account/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    accountInfo = await res.json();
  } catch (err) { accountInfo = { error: err.message }; }
  refreshAccount();
}
$('btn-account').onclick = () => { openPanel('account'); refreshAccount(); };
if (LIVE) { refreshAccount(); setInterval(refreshAccount, 30000); }
setInterval(() => minimap.draw(currentFloor, theme === 'light'), 300);

selectFloor(currentFloor, { fly: false });
applyTheme(theme);
applyView(HOME);
refreshAll();
tickClock();
const startPanel = params.get('panel');
if (PANELS[startPanel]) openPanel(startPanel);
else if (startPanel === 'screens') openGrid();
// no celular, o que espera decisão vem primeiro
else if (window.innerWidth < 700 && pendingCount()) openPanel('ideas');
if (params.get('tv') === '1') setTv(true);

// útil para depurar / ligar dados reais pelo console
window.office = { feed, world, focusRobot, selectFloor, openGrid, openScreen, openPanel, openTask, openPiece, setTv };
