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
import { buildWorld, FH } from './world.js';
import { fmt, fmtTime, pnlOf, pnlColor, drawMonitorChart, drawFullScreen } from './screens.js';

// ── fonte de dados ──  simulada por padrão; ?live=1 lê ./status.json
const params = new URLSearchParams(location.search);
const LIVE = params.get('live') === '1';
const feed = LIVE ? createLiveFeed({ url: './status.json', intervalMs: 5000 }) : createSimulatedFeed({ intervalMs: 1400 });
let mode = 'both'; // 'closed' | 'open' | 'both'

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
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 120 });
key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
scene.add(key, key.target);

// ── pós-processamento: bloom para o neon ──
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.45, 1.0));
composer.addPass(new OutputPass());

// ── mundo ──
const world = buildWorld(scene, FLOORS, ROBOTS, { getState: (id) => feed.getState(id), getMode: () => mode });

// ── vistas ──
const maxLevel = Math.max(...FLOORS.map((f) => f.level));
function viewFor(fid) {
  const a = aspect();
  if (!fid) {
    const h = Math.max(26 + maxLevel * FH * 0.86, 40 / a);
    return { target: new THREE.Vector3(0, (maxLevel * FH) / 2 + 1.5, 0), zoom: BASE_H / h };
  }
  const h = Math.max(31, 44 / a);
  return { target: new THREE.Vector3(0, world.floorY(fid) + 1.0, 1.2), zoom: BASE_H / h };
}
let currentFloor = FLOORS.some((f) => f.id === params.get('floor')) ? params.get('floor') : FLOORS[0].id;
if (params.get('floor') === 'all') currentFloor = null;
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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    el.innerHTML = `<div class="row"><span class="name">${r.name}</span><span class="pnl"></span></div><div class="row sub"><span class="info"></span><span class="pill"></span></div>`;
    el.addEventListener('click', () => focusRobot(r.id));
    sidebar.appendChild(el);
    cards.set(r.id, el);
  }
}

const floorBar = $('floorbar');
const floorBtns = new Map();
for (const f of [{ id: null, label: 'ALL', name: 'Prédio', sub: 'Todos os andares' }, ...FLOORS]) {
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
  // sombras só na vista de um andar (no prédio todo as lajes projetariam sombra umas nas outras)
  key.castShadow = !!fid;
  const y = fid ? world.floorY(fid) : (maxLevel * FH) / 2;
  key.position.set(14, y + 28, 18);
  key.target.position.set(0, y, 0);
  const u = new URL(location.href);
  u.searchParams.set('floor', fid || 'all');
  history.replaceState(null, '', u);
  if (fly) { clearFocus(false); flyTo(HOME); }
}

// ── resultado, contadores, cards ──
function renderSummary() {
  let op = 0, total = 0;
  for (const r of ROBOTS) {
    const s = feed.getState(r.id);
    if (s.status === 'operating') op++;
    total += pnlOf(s, mode);
  }
  $('count-working').textContent = op;
  $('count-idle').textContent = ROBOTS.length - op;
  const tv = $('total-value');
  tv.textContent = `${fmt(total)} ${total >= 0 ? '↗' : '↘'}`;
  tv.style.color = pnlColor(total);
}

function renderCards() {
  for (const r of ROBOTS) {
    const s = feed.getState(r.id);
    const el = cards.get(r.id);
    const v = pnlOf(s, mode);
    const pnl = el.querySelector('.pnl');
    pnl.textContent = fmt(v); pnl.style.color = pnlColor(v);
    el.querySelector('.info').textContent = s.status === 'operating' ? `${s.setup} · ${s.symbol} ${s.side}` : 'Em descanso';
    const pill = el.querySelector('.pill');
    pill.className = `pill ${s.status}`;
    pill.textContent = s.status === 'operating' ? 'operando' : 'descanso';
  }
}

// cartão do robô selecionado
const info = $('infocard');
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
    <div class="role">${esc(f.name)} · ${esc(f.sub)}</div>
    <div class="big" data-k="big"></div>
    <div class="kv">
      <span>Operação</span><span data-k="op"></span>
      <span>Setup</span><span data-k="setup"></span>
      <span>Aberto</span><span data-k="open"></span>
      <span>Fechado</span><span data-k="closed"></span>
      <span>Saldo</span><span data-k="balance"></span>
    </div>
    <canvas width="300" height="150"></canvas>
    <div class="label">Atividade recente</div>
    <ul data-k="events"></ul>
    <button class="open-screen">Abrir tela ▦</button>`;
  info.querySelector('.close').onclick = () => clearFocus();
  info.querySelector('.open-screen').onclick = () => openScreen(id);
}
function renderInfo(id) {
  if (infoFor !== id) buildInfo(id);
  const r = robotById(id);
  const s = feed.getState(id);
  const v = pnlOf(s, mode);
  const set = (k, text, color) => { const el = info.querySelector(`[data-k="${k}"]`); el.textContent = text; el.style.color = color || ''; };
  const pill = info.querySelector('[data-k="pill"]');
  pill.className = `pill ${s.status}`;
  pill.textContent = s.status === 'operating' ? 'operando' : 'descanso';
  set('big', fmt(v), pnlColor(v));
  set('op', s.status === 'operating' ? `${s.symbol} ${s.side}` : '—');
  set('setup', s.status === 'operating' ? s.setup : '—');
  set('open', fmt(s.openPnl, { sign: true }), pnlColor(s.openPnl));
  set('closed', fmt(s.closedPnl, { sign: true }), pnlColor(s.closedPnl));
  set('balance', fmt(s.balance));
  const ul = info.querySelector('[data-k="events"]');
  const recent = feed.history.filter((e) => e.robotId === id).slice(-4).reverse();
  ul.replaceChildren(...(recent.length ? recent : [null]).map((e) => {
    const li = document.createElement('li');
    if (e) { const t = document.createElement('time'); t.textContent = fmtTime(e.ts); li.append(t, e.message); } else li.textContent = 'Sem atividade ainda';
    return li;
  }));
  const cv = info.querySelector('canvas');
  drawMonitorChart(cv.getContext('2d'), cv.width, cv.height, s, r);
}

function focusRobot(id) {
  const a = world.actors.get(id);
  if (a.floor.id !== currentFloor && currentFloor) selectFloor(a.floor.id, { fly: false });
  selected = id;
  cards.forEach((el, k) => el.classList.toggle('selected', k === id));
  const p = a.pos.clone(); p.y += world.floorY(a.floor.id) + 1.4;
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

// ── overlay de telas ──
const overlay = $('overlay');
const ovBody = overlay.querySelector('.ov-body');
const ovTitle = overlay.querySelector('.ov-title');
let overlayState = null; // { kind: 'grid' } | { kind: 'one', id }
function drawOverlay() {
  if (!overlayState) return;
  if (overlayState.kind === 'one') {
    const cv = ovBody.querySelector('canvas');
    if (cv) drawFullScreen(cv.getContext('2d'), cv.width, cv.height, feed.getState(overlayState.id), robotById(overlayState.id), mode);
  } else {
    ovBody.querySelectorAll('canvas').forEach((cv) => drawFullScreen(cv.getContext('2d'), cv.width, cv.height, feed.getState(cv.dataset.id), robotById(cv.dataset.id), mode));
  }
}
function openScreen(id) {
  overlayState = { kind: 'one', id };
  ovTitle.textContent = `Tela · ${id}`;
  ovBody.innerHTML = '<canvas width="1120" height="630"></canvas>';
  overlay.classList.remove('hidden');
  drawOverlay();
}
function openGrid() {
  overlayState = { kind: 'grid' };
  ovTitle.textContent = 'Telas de todos os robôs';
  ovBody.innerHTML = FLOORS.map((f) => `<div class="ov-floor">${f.label} · ${esc(f.name)}</div><div class="ov-grid">${ROBOTS.filter((r) => r.floor === f.id).map((r) => `<canvas width="480" height="270" data-id="${r.id}"></canvas>`).join('')}</div>`).join('');
  ovBody.querySelectorAll('canvas').forEach((cv) => cv.addEventListener('click', () => openScreen(cv.dataset.id)));
  overlay.classList.remove('hidden');
  drawOverlay();
}
function closeOverlay() { overlayState = null; overlay.classList.add('hidden'); }
overlay.querySelector('.ov-close').onclick = closeOverlay;
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
$('btn-screens').onclick = () => (overlayState ? closeOverlay() : openGrid());
// lista lateral recolhível (começa fechada em telas estreitas para não cobrir o andar)
const toggleSide = (open) => { sidebar.style.display = open ? '' : 'none'; $('btn-list').classList.toggle('on', open); };
$('btn-list').onclick = () => toggleSide(sidebar.style.display === 'none');
toggleSide(window.innerWidth >= 1280);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (overlayState) closeOverlay(); else clearFocus(); }
  if (e.key === 'r' || e.key === 'R') clearFocus();
});

// filtro Fechados / Abertos / Ambos
$('mode-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  mode = b.dataset.mode;
  $('mode-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  refreshAll();
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
  if (hit) focusRobot(hit.object.userData.robotId);
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

// útil para depurar / ligar dados reais pelo console
window.office = { feed, world, focusRobot, selectFloor, openGrid, openScreen };
