import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { OFFICE, FLOORS, ROBOTS, COLUMNS, robotById } from './data/robots.js';
import { createSimulatedFeed } from './data/feed.js';
import { createLiveFeed } from './data/live.js';
import { buildWorld } from './world.js';
import { AREA, FOCUS, SEVERITY, SCREEN, screenState, fmtTime, pct, doneLabel, drawMonitorWork, drawFullScreen, drawCanvasWall, drawWallChart } from './screens.js';
import { computeMetrics, buildToday, usd } from './data/stats.js';
import { NETWORKS, STAGES } from './data/marketing.js';

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
scene.add(new THREE.HemisphereLight(0xb4c0f0, 0x3a2e14, 1.5));
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  // pausa
  $('btn-pause').textContent = feed.paused ? '▶ Continuar' : '⏸ Pausar';
  $('btn-pause').classList.toggle('on', !!feed.paused);
  $('paused-banner').hidden = !feed.paused;
  $('paused-text').textContent = feed.paused ? `Escritório pausado: ${feed.pauseReason || 'pausado por você'}.` : '';
  $('paused-budget').hidden = !/orçamento/.test(feed.pauseReason || '');
  document.body.classList.toggle('is-paused', !!feed.paused);
}
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
const who = (id) => (id ? `<span style="color:${robotById(id)?.color || 'inherit'}">${esc(id)}</span>` : '—');
const ORIGIN = {
  security: (t) => `🛡 achado da auditoria de ${who(t.from)}`,
  ops: (t) => `⚠ erro em produção visto por ${who(t.from)}`,
  idea: (t) => `sugestão de ${who(t.from)}, aprovada por você`,
};

// prévia de um criativo da agência: as cores e o título que o ARTE_01 / VIDEO_01 escolheram
const creative = (p, size = '') => `
  <div class="creative ${p.video ? 'is-video' : ''} ${size}" style="--bg:${p.visual?.palette[0] || '#2a2e42'};--fg:${p.visual?.palette[1] || '#e6e8f5'}">
    <span class="net">${esc(NETWORKS[p.network].label)} · ${esc(p.format)}</span>
    <b>${esc(p.visual?.headline || p.hook)}</b>
    ${p.video ? '<i class="play">▶</i>' : ''}${p.slides ? `<i class="slides">1/${p.slides}</i>` : ''}
    <small>${p.visual ? esc(p.visual.layout) : 'arte ainda não feita'}</small>
  </div>`;
const fmtN = (n) => (n || 0).toLocaleString('pt-BR');

function pieceHtml(id) {
  const p = feed.marketing?.pieces.find((x) => x.id === id);
  if (!p) return '<p class="empty">Essa peça não existe mais.</p>';
  const idea = feed.ideas.find((i) => i.piece === p.id && i.status === 'aguardando');
  return `
    <div class="piece">
      <div class="piece-preview">${creative(p, 'big')}
        ${p.score != null ? `<div class="scores">${Object.entries(p.scores).map(([k, v]) => `<span class="${v >= 7.5 ? 'ok' : 'low'}">${esc(k)} <b>${v.toFixed(1)}</b></span>`).join('')}<span class="total">nota <b>${p.score.toFixed(1)}</b></span></div>` : ''}
        ${idea && feed.canDecide ? `<div class="decide"><button data-approve="${esc(idea.id)}">✔ Aprovar e agendar</button><button data-adjust="${esc(idea.id)}" class="mid">✎ Pedir ajuste</button><button data-reject="${esc(idea.id)}" class="no">Recusar</button></div>` : ''}
      </div>
      <div class="piece-info">
        <div class="kv-row"><span>Etapa <b>${esc(STAGES.find((x) => x.id === p.stage)?.label || p.stage)}</b></span><span>Pauta <b>${esc(p.angle)}</b></span>${p.scheduledAt && p.stage === 'agendado' ? `<span>Agendado <b>${new Date(p.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b></span>` : ''}</div>
        ${p.metrics ? `<div class="tiles">${[['Alcance', p.metrics.reach], ['Curtidas', p.metrics.likes], ['Comentários', p.metrics.comments], ['Salvamentos', p.metrics.saves], ['Cliques no link', p.metrics.clicks]].map(([k, v]) => `<div class="tile"><small>${k}</small><b>${fmtN(v)}</b></div>`).join('')}</div>` : ''}
        <div class="ov-floor">Legenda</div>
        ${p.caption ? `<pre class="caption">${esc(p.caption)}\n\n${esc(p.hashtags.join(' '))}</pre><button class="copy" data-copy="${esc(`${p.caption}\n\n${p.hashtags.join(' ')}`)}">Copiar legenda</button>` : '<p class="empty">O COPY_01 ainda não escreveu.</p>'}
        ${p.script.length ? `<div class="ov-floor">Roteiro (${esc(p.format)})</div><table class="script"><tbody>${p.script.map((c) => `<tr><td>${esc(c.t)}</td><td>${esc(c.scene)}</td><td>“${esc(c.line)}”</td></tr>`).join('')}</tbody></table>` : ''}
        ${p.feedback.length ? `<div class="ov-floor">Ajustes pedidos</div><ul class="changes one">${p.feedback.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <div class="ov-floor">Linha do tempo</div>
        <ol class="timeline">${p.timeline.map((e) => `<li><time>${fmtTime(new Date(e.ts))}</time><b>${who(e.robotId)}</b> ${esc(e.text)}</li>`).join('')}</ol>
      </div>
    </div>`;
}

const PANELS = {
  marketing: {
    title: 'Agência de marketing · criativos e vídeos',
    html: () => {
      const m = feed.marketing;
      if (!m) return '<p class="empty">A agência de marketing ainda não está ligada no motor; ela roda na simulação.</p>';
      const live = m.pieces.filter((p) => p.metrics);
      const sum = (k) => live.reduce((n, p) => n + p.metrics[k], 0);
      const waiting = feed.ideas.filter((i) => ['post', 'divulgação'].includes(i.focus) && i.status === 'aguardando').length;
      const tiles = [['Publicados', live.length], ['Alcance', sum('reach')], ['Curtidas e comentários', sum('likes') + sum('comments')], ['Salvamentos', sum('saves')], ['Cliques no link', sum('clicks')]];
      return `
        <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${k}</small><b>${fmtN(v)}</b></div>`).join('')}</div>
        ${waiting ? `<button data-open="ideas" class="today-cta mkt-cta">${waiting} post(s) e ideia(s) de divulgação esperando a sua aprovação →</button>` : '<p class="panel-hint">Nada publica sem você: cada criativo aprovado pela agência vem para a sua aprovação antes de ir para as redes.</p>'}
        <div class="mkt-board">${STAGES.map((st) => {
          const list = m.pieces.filter((p) => p.stage === st.id).slice(-8).reverse();
          return `<section class="col"><h4>${esc(st.label)} <b>${m.pieces.filter((p) => p.stage === st.id).length}</b></h4>${list.map((p) => `
            <article class="piece-card" data-piece="${esc(p.id)}">${creative(p)}<div class="pc-meta"><b>${esc(p.id)}</b>${p.score != null ? ` · nota ${p.score.toFixed(1)}` : ''}${p.metrics ? ` · ${fmtN(p.metrics.reach)} de alcance` : ''}</div></article>`).join('') || '<p class="empty">vazio</p>'}</section>`;
        }).join('')}</div>
        <div class="ov-floor">Divulgação</div>
        ${m.promotions.length ? `<ul class="changes one">${m.promotions.slice().reverse().map((x) => `<li><b class="promo ${esc(x.status)}">${esc(x.status)}</b> ${esc(x.title)} <small>${esc(x.detail)}</small></li>`).join('')}</ul>` : '<p class="empty">O MKT_LEAD propõe formas de divulgação quando houver resultado dos primeiros posts.</p>'}`;
    },
  },
  board: {
    title: 'Board do GitHub · PetLive',
    html: () => `<p class="panel-hint">Arraste os cards do Backlog para mudar a prioridade: o P.O sempre pega o primeiro que tem dev livre. Clique num card para ver a linha do tempo.</p>
      <div class="kanban">${COLUMNS.map((c) => {
      const tasks = feed.board.filter((t) => t.column === c.id);
      // o Backlog aparece na ordem de prioridade; as outras colunas, a mais recente em cima
      const shown = c.id === 'todo' ? tasks.slice(0, 14) : tasks.slice(-14).reverse();
      return `<section class="col col-${c.id}" data-col="${c.id}"><h4>${esc(c.label)} <b>${tasks.length}</b></h4>${shown.map((t, i) => {
        const open = (t.findings || []).filter((f) => f.open);
        const fix = t.origin === 'security' || t.origin === 'ops';
        return `
        <article class="task-card${fix ? ' sec-fix' : ''}" data-task="${esc(t.id)}" ${c.id === 'todo' ? 'draggable="true"' : ''} style="--a:${fix ? SEVERITY.alta : AREA[t.area].color}">
          <div class="tc-top"><b>${c.id === 'todo' ? `<i class="prio">${i + 1}</i>` : ''}${esc(t.id)}</b><span class="area">${AREA[t.area].label}</span></div>
          <div class="tc-title">${esc(t.title)}</div>
          ${open.map((f) => `<div class="finding" style="--s:${SEVERITY[f.severity]}"><b>${esc(f.severity)}</b> ${esc(f.title)}<small>${esc(f.fix)}</small></div>`).join('')}
          <div class="tc-meta">${t.dev ? `dev ${who(t.dev)}` : ORIGIN[t.origin]?.(t) || 'aguardando o P.O'}${t.secBy ? ` · revisão ${who(t.secBy)}` : ''}${t.qa ? ` · QA ${who(t.qa)}` : ''}${t.commits?.length ? ` · ${t.commits.length} commits` : ''}${t.rework ? ` · ${t.rework}× correção` : ''}${t.findings?.length && !open.length ? ` · 🛡 ${t.findings.length} corrigida(s)` : ''}${t.released ? ` · ${esc(t.released)} em produção` : ''}${t.cost ? ` · ${usd(t.cost)}` : ''}</div>
        </article>`;
      }).join('') || '<p class="empty">vazio</p>'}</section>`;
    }).join('')}</div>`,
  },
  reports: {
    title: 'Relatórios do QA',
    html: () => (feed.reports.length ? feed.reports.slice().reverse().map((r) => `
      <article class="report" style="--a:${AREA[r.area].color}" data-task="${esc(r.taskId)}">
        <header><b>${esc(r.taskId)}</b> ${esc(r.title)} <span class="ok">✔ merge em ${esc(OFFICE.baseBranch)}</span><time>${fmtTime(r.ts)}</time></header>
        <p>${esc(r.summary)}</p>
        <div class="kv-row">
          <span>Área <b>${AREA[r.area].label}</b></span><span>Dev ${who(r.dev)}</span><span>QA ${who(r.qa)}</span>
          <span>Branch <code>${esc(r.branch)}</code></span><span>Commits <b>${r.commits}</b></span>
          <span>Testes <b>${r.tests.passed}/${r.tests.total}</b></span><span>Correções <b>${r.rework}</b></span>
          <span>Segurança ${r.security?.reviewer ? who(r.security.reviewer) : '—'} <b>${r.security?.findings.length ? `${r.security.findings.length} falha(s) corrigida(s)` : 'sem falhas'}</b></span>
          ${r.cost ? `<span>Custo <b>${usd(r.cost)}</b></span>` : ''}
        </div>
        ${(r.security?.findings || []).map((f) => `<div class="finding" style="--s:${SEVERITY[f.severity] || '#facc15'}"><b>${esc(f.severity)}</b> ${esc(f.title)} <small>corrigida antes do merge</small></div>`).join('')}
      </article>`).join('') : '<p class="empty">Nenhuma task entregue ainda. O QA escreve o relatório quando aprova e faz o merge.</p>'),
  },
  canvas: {
    title: 'Canvas do projeto',
    html: () => {
      const c = feed.canvas;
      if (!c) return '<p class="empty">Nenhum canvas ligado ao escritório.</p>';
      const pending = feed.ideas.filter((i) => i.focus === 'canvas' && i.status === 'aguardando').length;
      const phases = Map.groupBy(c.screens, (sc) => sc.phaseName);
      return `
        <div class="canvas-head">
          <div><b>${esc(c.title)}</b><small>${c.screens.length} telas · snapshot ${esc(c.version || '')} de ${c.syncedAt.toLocaleDateString('pt-BR')}</small></div>
          ${pending ? `<button data-open="ideas">${pending} tela(s) aguardando sua aprovação</button>` : ''}
          <a class="open-canvas" href="${esc(c.url)}" target="_blank" rel="noopener">Abrir o canvas ↗</a>
        </div>
        <canvas class="canvas-map" width="1120" height="400"></canvas>
        <div class="ov-floor">O que o robô do canvas viu</div>
        <ul class="changes">${c.changes.slice(-10).reverse().map((ch) => `<li><time>${fmtTime(ch.ts)}</time>${esc(ch.text)}</li>`).join('') || '<li>Ainda não conferiu o canvas.</li>'}</ul>
        ${[...phases].map(([phase, list]) => `
          <div class="ov-floor">${esc(phase)}</div>
          ${[...Map.groupBy(list, (sc) => sc.section)].map(([section, items]) => `
            <h5 class="cv-section">${esc(section)}</h5>
            <div class="cv-screens">${items.map((sc) => {
              const st = screenState(sc);
              return `<span class="cv-screen" style="--c:${SCREEN[st].color}" title="${esc(SCREEN[st].label)}${sc.taskId ? ` · ${esc(sc.taskId)}` : ''}">${esc(sc.name)}</span>`;
            }).join('')}</div>`).join('')}`).join('')}`;
    },
  },
  ideas: {
    title: 'Aguardando sua aprovação',
    html: () => {
      if (!feed.ideas.length) return '<p class="empty">Nada esperando você ainda. Os robôs seguem analisando o SaaS.</p>';
      const pending = feed.ideas.filter((i) => i.status === 'aguardando').reverse();
      const decided = feed.ideas.filter((i) => i.status !== 'aguardando').reverse();
      const card = (i) => {
        const release = i.focus === 'release';
        const post = i.focus === 'post' && feed.marketing?.pieces.find((p) => p.id === i.piece);
        const approveLabel = release ? `✔ Aprovar e mandar para ${esc(OFFICE.productionBranch)}` : post ? '✔ Aprovar e agendar' : i.focus === 'divulgação' ? '✔ Aprovar a divulgação' : '✔ Aprovar e mandar para o board';
        return `
        <article class="idea ${i.status}${release ? ' release' : ''}${post ? ' post' : ''}" style="--a:${(FOCUS[i.focus] || FOCUS.dev).color}">
          <header><span class="tag">${(FOCUS[i.focus] || FOCUS.dev).label}</span><span class="status">${esc(i.status)}${i.taskId ? ` · ${esc(i.taskId)}${release ? '' : ' no board'}` : ''}</span></header>
          ${post ? `<div class="post-row" data-piece="${esc(post.id)}">${creative(post)}<div><h4>${esc(i.title)}</h4><pre class="caption">${esc(post.caption)}</pre><small>nota da agência ${post.score?.toFixed(1)} · ver roteiro, avaliação e linha do tempo →</small></div></div>` : `<h4>${esc(i.title)}</h4><p>${esc(i.detail)}</p>`}
          <footer>${who(i.by)} · ${fmtTime(i.ts)}</footer>
          ${i.status === 'aguardando' && feed.canDecide ? `<div class="decide"><button data-approve="${esc(i.id)}">${approveLabel}</button>${post ? `<button data-adjust="${esc(i.id)}" class="mid">✎ Pedir ajuste</button>` : ''}<button data-reject="${esc(i.id)}" class="no">${release ? 'Segurar' : 'Recusar'}</button></div>` : ''}
        </article>`;
      };
      return `<div class="ov-floor">Aguardando sua aprovação · ${pending.length}</div>
        ${feed.canDecide ? '' : '<p class="empty">A aprovação pelo escritório precisa do servidor do motor (npm run motor). Sem ele, o escritório só mostra.</p>'}
        ${pending.length ? `<div class="ideas">${pending.map(card).join('')}</div>` : '<p class="empty">Nada esperando você. Os robôs seguem analisando.</p>'}
        ${decided.length ? `<div class="ov-floor">Decididas</div><div class="ideas">${decided.slice(0, 30).map(card).join('')}</div>` : ''}`;
    },
  },
  releases: {
    title: 'Produção · releases, erros e changelog',
    html: () => {
      const waiting = feed.board.filter((t) => t.column === 'merged' && !t.released);
      const pendingRelease = feed.ideas.find((i) => i.focus === 'release' && i.status === 'aguardando');
      const last = feed.releases?.at(-1);
      return `
        <div class="prod-head">
          <div><small>Em produção (${esc(OFFICE.productionBranch)})</small><b>${last ? esc(last.version) : 'nenhum release ainda'}</b>${last ? `<small>${last.ts.toLocaleString('pt-BR')}</small>` : ''}</div>
          <div><small>Em ${esc(OFFICE.baseBranch)}, esperando release</small><b>${waiting.length} entrega(s)</b><small>${esc(waiting.slice(0, 4).map((t) => t.title).join(', '))}${waiting.length > 4 ? '…' : ''}</small></div>
          ${pendingRelease ? `<button data-open="ideas">${esc(pendingRelease.title)} espera você</button>` : `<p class="panel-hint">Os robôs só fazem merge em ${esc(OFFICE.baseBranch)}. O OPS_01 propõe o release a cada ${4} entregas, e ele só vai para ${esc(OFFICE.productionBranch)} com a sua aprovação.</p>`}
        </div>
        <div class="ov-floor">Erros em produção</div>
        ${(feed.incidents || []).length ? `<ul class="changes">${feed.incidents.slice().reverse().slice(0, 10).map((i) => `<li><time>${fmtTime(i.ts)}</time><b style="color:${SEVERITY[i.severity]}">${esc(i.severity)}</b> ${esc(i.error)} · ${i.count}× · ${esc(i.release || '')} · correção ${esc(i.taskId)}</li>`).join('')}</ul>` : '<p class="empty">Nenhum erro em produção.</p>'}
        <div class="ov-floor">Releases</div>
        ${(feed.releases || []).length ? feed.releases.slice().reverse().map((r) => `
          <article class="report" style="--a:#34d399">
            <header><b>${esc(r.version)}</b> ${r.tasks.length} entregas <time>${r.ts.toLocaleString('pt-BR')}</time></header>
            <p>${esc(r.notes)}</p>
            <button class="copy" data-copy="${esc(`PetLive ${r.version}\n${r.notes}`)}">Copiar notas para as lojas</button>
          </article>`).join('') : '<p class="empty">Nenhum release ainda.</p>'}
        <div class="ov-floor">CHANGELOG (DOCS_01)</div>
        ${(feed.changelog || []).length ? `<ul class="changes one">${feed.changelog.slice().reverse().slice(0, 20).map((c) => `<li><time>${fmtTime(c.ts)}</time>${esc(c.text)} <small>${esc(c.taskId)}</small></li>`).join('')}</ul>` : '<p class="empty">Nada documentado ainda.</p>'}`;
    },
  },
  today: {
    title: 'Resumo do dia',
    html: () => {
      const d = buildToday(feed);
      return `
        <div class="today-actions"><button class="copy" data-copy="${esc(d.text)}">Copiar para o WhatsApp</button></div>
        <pre class="today-text">${esc(d.text)}</pre>
        ${d.pending.length ? `<button data-open="ideas" class="today-cta">${d.pending.length} item(ns) esperando a sua decisão →</button>` : ''}
        ${(feed.insights || []).length ? `<div class="ov-floor">Uso das telas (DATA_01)</div><ul class="changes one">${feed.insights.slice().reverse().slice(0, 8).map((i) => `<li><time>${fmtTime(i.ts)}</time>${esc(i.text)}</li>`).join('')}</ul>` : ''}`;
    },
  },
  metrics: {
    title: 'Métricas do time',
    html: () => {
      const m = computeMetrics(feed);
      const pctTxt = (v) => `${Math.round(v * 100)}%`;
      const tiles = [
        ['Entregues', String(m.delivered)],
        ['Tempo médio por task', m.cycleAvg],
        ['Reprovação no QA', pctTxt(m.qaRejectRate)],
        ['Reprovação na segurança', pctTxt(m.secRejectRate)],
        ['Custo médio por task', usd(m.costPerTask)],
        ['Gasto hoje', `${usd(m.spendToday)} de ${usd(m.budget)}`],
      ];
      return `
        <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
        <div class="budget-row">
          <span>Orçamento do dia</span>
          <button data-budget="-5">− US$ 5</button><b>${usd(m.budget)}</b><button data-budget="5">+ US$ 5</button>
        </div>
        <canvas class="spend-chart" width="1120" height="260"></canvas>
        ${feed.remembers ? '<p class="panel-hint">A simulação guarda tudo neste navegador. <button class="link" data-reset>Recomeçar do zero</button></p>' : ''}
        <div class="ov-floor">Filas ${m.bottleneck ? `· gargalo: ${esc(m.bottleneck.label)}` : ''}</div>
        <div class="queues">${m.queues.map((q) => `<div class="queue${m.bottleneck?.id === q.id ? ' hot' : ''}"><small>${esc(q.label)}</small><b>${q.size}</b><i style="width:${Math.min(100, q.load * 25)}%"></i><small>${q.robots} robô(s)</small></div>`).join('')}</div>
        <div class="ov-floor">Gasto por robô</div>
        <table class="costs"><tbody>${m.perRobot.slice(0, 12).map((r) => `<tr><td>${who(r.id)}</td><td>${usd(r.cost)}</td><td>${r.done} ${esc(doneLabel(robotById(r.id)))}</td></tr>`).join('')}</tbody></table>`;
    },
  },
  audit: {
    title: 'Histórico completo',
    // a busca fica fora do trecho que redesenha, senão perderia o foco a cada atualização
    shell: () => `<div class="audit-filter"><input data-audit-q placeholder="buscar: #123, WEB_01, release, aprovou…" /><select data-audit-kind><option value="">tudo</option><option>decisão</option><option>alerta</option><option>evento</option><option>sugestão</option><option>release</option><option>conversa</option></select></div><div data-body></div>`,
    html: () => {
      const q = (ovBody.querySelector('[data-audit-q]')?.value || '').toLowerCase();
      const kind = ovBody.querySelector('[data-audit-kind]')?.value || '';
      const rows = (feed.audit || []).filter((e) => (!kind || e.kind === kind) && (!q || `${e.actor} ${e.text} ${e.taskId || ''}`.toLowerCase().includes(q)));
      return `<p class="panel-hint">${rows.length} registro(s)${feed.audit?.length ? ` · desde ${fmtTime(feed.audit[0].ts)}` : ''}</p>
        <ul class="audit">${rows.slice(-300).reverse().map((e) => `<li class="k-${esc(e.kind)}"><time>${e.ts.toLocaleTimeString('pt-BR')}</time><span class="kind">${esc(e.kind)}</span><b>${e.actor === 'VOCÊ' ? 'VOCÊ' : who(e.actor)}</b> ${esc(e.text)}</li>`).join('')}</ul>`;
    },
  },
};

// linha do tempo de uma task: do board ao merge (e à produção), com cada passo por robô
function taskHtml(id) {
  const t = feed.task(id);
  if (!t) return '<p class="empty">Essa task já saiu do board.</p>';
  return `
    <div class="task-head" style="--a:${AREA[t.area].color}">
      <b>${esc(t.id)} · ${esc(t.title)}</b>
      <small>${AREA[t.area].label} · ${esc(COLUMNS.find((c) => c.id === t.column)?.label || t.column)} · <code>${esc(t.branch)}</code>${t.cost ? ` · ${usd(t.cost)}` : ''}${t.released ? ` · ${esc(t.released)} em produção` : ''}</small>
    </div>
    <ol class="timeline">${(t.timeline || []).map((e) => `<li><time>${fmtTime(new Date(e.ts))}</time><b>${e.robotId === 'VOCÊ' ? 'VOCÊ' : who(e.robotId)}</b> ${esc(e.text)}</li>`).join('')}</ol>
    ${t.commits?.length ? `<div class="ov-floor">Commits</div><ul class="changes one">${t.commits.map((c) => `<li><code>${esc(c.sha.slice(0, 7))}</code> ${esc(c.message)}</li>`).join('')}</ul>` : ''}`;
}

ovBody.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]');
  if (open) return openPanel(open.dataset.open, { toggle: false });
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copiado ✔'; } catch { copy.textContent = 'Não deu para copiar'; }
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
selectFloor(currentFloor, { fly: false });
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
