// Desenho em canvas: monitores das mesas, painéis das paredes e a tela grande de cada robô.
import { COLUMNS } from './data/robots.js';

const UP = '#34d399';
const DOWN = '#f87171';
const GOLD = '#ffc400';
const MUTED = '#8087a8';

export const AREA = {
  web: { label: 'Next.js', color: '#38bdf8' },
  app: { label: 'React Native', color: '#c084fc' },
};
export const FOCUS = {
  dev: { label: 'Desenvolvimento', color: '#38bdf8' },
  design: { label: 'Design', color: '#f472b6' },
  ux: { label: 'UX e produto', color: '#a3e635' },
  canvas: { label: 'Canvas', color: '#22d3ee' },
  a11y: { label: 'Acessibilidade', color: '#a78bfa' },
  data: { label: 'Dados', color: '#fbbf24' },
  release: { label: 'Release', color: '#34d399' },
  post: { label: 'Post', color: '#fb7185' },
  'divulgação': { label: 'Divulgação', color: '#f472b6' },
};

// status de uma tela do canvas
export const SCREEN = {
  entregue: { label: 'Entregue', color: '#34d399' },
  'em dev': { label: 'Em desenvolvimento', color: '#38bdf8' },
  planejada: { label: 'Planejada', color: '#6b7090' },
  futuro: { label: 'Futuro', color: '#2a2e42' },
  desatualizada: { label: 'Canvas mudou', color: '#f97316' },
};
export const screenState = (sc) => (sc.outdated ? 'desatualizada' : sc.status);

export const SEVERITY = {
  alta: '#ef4444',
  média: '#f97316',
  baixa: '#facc15',
};

export const fmtTime =(d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const fmtClock = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const pct = (p) => `${Math.round((p || 0) * 100)}%`;

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function bg(ctx, w, h, color = '#070a12') {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

// corta o texto com reticências para caber na largura
function fit(ctx, text, maxW) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function bar(ctx, x, y, w, h, p, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.min(1, Math.max(0, p || 0)), h);
}

// números pseudoaleatórios estáveis por semente: o "código" do monitor não pisca a cada redesenho
function seeded(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) | 0;
  return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
}

function chart(ctx, x, y, w, h, series, { fill = true } = {}) {
  if (!series || series.length < 2) return;
  let min = Math.min(...series), max = Math.max(...series);
  if (max - min < 1e-6) { max += 1; min -= 1; }
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const px = (i) => x + (i / (series.length - 1)) * w;
  const py = (v) => y + h - ((v - min) / (max - min)) * h;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  for (let k = 0; k <= 3; k++) { const yy = y + (h * k) / 3; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
  const color = UP;
  if (fill) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgba(color, 0.32)); g.addColorStop(1, rgba(color, 0));
    ctx.beginPath(); ctx.moveTo(px(0), y + h);
    series.forEach((v, i) => ctx.lineTo(px(i), py(v)));
    ctx.lineTo(px(series.length - 1), y + h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  }
  ctx.beginPath();
  series.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, h / 60); ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(px(series.length - 1), py(series[series.length - 1]), Math.max(3, h / 40), 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}

// ── conteúdo do monitor esquerdo, por papel ──

function idleScreen(ctx, w, h, robot) {
  ctx.fillStyle = '#6b7090'; ctx.font = `bold ${h * 0.14}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(robot.kind === 'idea' ? 'EM PAUSA' : 'LIVRE', w / 2, h * 0.55); ctx.textAlign = 'left';
}

// mini kanban: quantas tasks em cada coluna
function kanban(ctx, x, y, w, h, board) {
  const cols = COLUMNS.filter((c) => c.id !== 'refining');
  const cw = w / cols.length;
  cols.forEach((c, i) => {
    const cx = x + i * cw;
    const tasks = board.filter((t) => t.column === c.id || (c.id === 'todo' && t.column === 'refining'));
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(cx + 2, y, cw - 4, h);
    ctx.fillStyle = c.id === 'merged' ? UP : c.id === 'rework' ? DOWN : c.id === 'security' ? SEVERITY.alta : GOLD;
    ctx.font = `bold ${Math.max(8, h * 0.09)}px system-ui, sans-serif`; ctx.textBaseline = 'top';
    ctx.fillText(fit(ctx, `${c.label.split(' ')[0]} ${tasks.length}`, cw - 8), cx + 5, y + 4);
    const ch = Math.max(4, h * 0.075);
    tasks.slice(-9).forEach((t, k) => {
      const yy = y + h * 0.2 + k * (ch + 3);
      if (yy + ch > y + h) return;
      ctx.fillStyle = rgba(AREA[t.area].color, 0.75); ctx.fillRect(cx + 5, yy, cw - 10, ch);
    });
  });
}

function editor(ctx, w, h, task) {
  const rnd = seeded(`${task.id}${task.commits.length}`);
  ctx.fillStyle = '#0d1220'; ctx.fillRect(0, h * 0.12, w * 0.22, h);
  ctx.fillStyle = MUTED; ctx.font = `${h * 0.07}px ui-monospace, Consolas, monospace`; ctx.textBaseline = 'top';
  ctx.fillText(fit(ctx, `${task.scope}/${task.area === 'web' ? 'page.tsx' : 'Screen.tsx'}`, w * 0.7), w * 0.25, h * 0.14);
  for (let k = 0; k < 6; k++) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(w * 0.03, h * (0.27 + k * 0.1), w * (0.08 + rnd() * 0.1), h * 0.035); }
  const palette = ['#c084fc', '#38bdf8', '#facc15', '#a3e635', '#f472b6', '#e2e8f0'];
  const lines = 9;
  for (let k = 0; k < lines; k++) {
    let x = w * 0.26 + (rnd() < 0.6 ? w * 0.04 * Math.floor(rnd() * 3) : 0);
    const yy = h * (0.26 + k * 0.08);
    const parts = 1 + Math.floor(rnd() * 3);
    for (let p = 0; p < parts && x < w * 0.95; p++) {
      const len = w * (0.05 + rnd() * 0.16);
      ctx.fillStyle = rgba(pickFrom(palette, rnd), 0.85); ctx.fillRect(x, yy, Math.min(len, w * 0.95 - x), h * 0.04);
      x += len + w * 0.02;
    }
  }
  ctx.fillStyle = GOLD; ctx.fillRect(w * 0.26, h * (0.26 + lines * 0.08), w * 0.012, h * 0.05); // cursor
}
const pickFrom = (a, rnd) => a[Math.floor(rnd() * a.length)];

function testRunner(ctx, w, h, s, task) {
  const rnd = seeded(task.id);
  const rows = 8;
  const doneRows = Math.floor(s.progress * rows);
  ctx.font = `${h * 0.075}px ui-monospace, Consolas, monospace`; ctx.textBaseline = 'top';
  for (let k = 0; k < rows; k++) {
    const yy = h * (0.15 + k * 0.095);
    const name = `${task.scope} ${['renderiza', 'salva', 'valida', 'navega', 'lista', 'filtra', 'carrega', 'envia'][k]}`;
    if (k < doneRows) { ctx.fillStyle = UP; ctx.fillText('✓', w * 0.05, yy); ctx.fillStyle = '#c7cbe0'; }
    else if (k === doneRows) { ctx.fillStyle = GOLD; ctx.fillText('●', w * 0.05, yy); ctx.fillStyle = GOLD; }
    else { ctx.fillStyle = '#3a3f58'; ctx.fillText('○', w * 0.05, yy); }
    ctx.fillText(fit(ctx, name, w * 0.6), w * 0.13, yy);
    if (k < doneRows) { ctx.fillStyle = MUTED; ctx.fillText(`${Math.round(rnd() * 900 + 40)}ms`, w * 0.78, yy); }
  }
}

// mapa do canvas: cada tela é um quadrinho, na ordem do canvas, colorido pelo status no código.
// Telas de celular são mais altas que largas; as de computador, o contrário.
function canvasMap(ctx, x, y, w, h, canvas) {
  const screens = canvas.screens;
  const cols = Math.ceil(Math.sqrt((screens.length * w) / h * 1.6));
  const cw = w / cols;
  const rows = Math.ceil(screens.length / cols);
  const ch = Math.min(h / rows, cw * 1.6);
  screens.forEach((sc, i) => {
    const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * ch;
    const app = sc.kind === 'app';
    const bw = (app ? 0.55 : 0.85) * cw, bh = (app ? 0.85 : 0.6) * ch;
    ctx.fillStyle = SCREEN[screenState(sc)].color;
    ctx.fillRect(cx + (cw - bw) / 2, cy + (ch - bh) / 2, bw, bh);
  });
}

function canvasLegend(ctx, x, y, size, canvas) {
  const counts = {};
  canvas.screens.forEach((sc) => { const k = screenState(sc); counts[k] = (counts[k] || 0) + 1; });
  ctx.font = `${size}px system-ui, sans-serif`; ctx.textBaseline = 'top';
  let cx = x;
  for (const [k, v] of Object.entries(SCREEN)) {
    if (!counts[k]) continue;
    ctx.fillStyle = v.color; ctx.fillRect(cx, y + size * 0.15, size * 0.8, size * 0.8);
    const label = `${counts[k]} ${v.label.toLowerCase()}`;
    ctx.fillStyle = '#c7cbe0'; ctx.fillText(label, cx + size * 1.1, y);
    cx += size * 1.1 + ctx.measureText(label).width + size * 1.2;
  }
}

// Painel do canvas (parede e tela grande)
export function drawCanvasWall(ctx, w, h, canvas) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.08}px system-ui, sans-serif`;
  ctx.fillText(fit(ctx, `CANVAS · ${canvas.title.toUpperCase()}`, w * 0.92), w * 0.04, h * 0.06);
  canvasLegend(ctx, w * 0.04, h * 0.18, h * 0.055, canvas);
  canvasMap(ctx, w * 0.04, h * 0.3, w * 0.92, h * 0.64, canvas);
}

// scanner de segurança: o código passando, com a linha suspeita marcada em vermelho
function scanner(ctx, w, h, s, task) {
  const rnd = seeded(task ? task.id : `audit${s.done}`);
  ctx.fillStyle = MUTED; ctx.font = `${h * 0.07}px ui-monospace, Consolas, monospace`; ctx.textBaseline = 'top';
  ctx.fillText(fit(ctx, task ? `revisão · ${task.branch}` : 'auditoria · develop', w * 0.9), w * 0.04, h * 0.14);
  const lines = 8;
  const at = Math.floor(s.progress * lines);
  for (let k = 0; k < lines; k++) {
    const y = h * (0.27 + k * 0.08);
    if (k === at) { ctx.fillStyle = 'rgba(239,68,68,0.22)'; ctx.fillRect(0, y - h * 0.015, w, h * 0.07); }
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(w * 0.04, y, w * 0.05, h * 0.04);
    ctx.fillStyle = k === at ? SEVERITY.alta : rgba('#94a3b8', 0.6);
    ctx.fillRect(w * (0.13 + rnd() * 0.05), y, w * (0.2 + rnd() * 0.5), h * 0.04);
  }
  // o "escudo" no canto
  ctx.strokeStyle = SEVERITY.alta; ctx.lineWidth = Math.max(1.5, h / 70);
  const cx = w * 0.88, cy = h * 0.2, r = h * 0.07;
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy - r * 0.5); ctx.lineTo(cx + r * 0.8, cy + r * 0.6); ctx.lineTo(cx, cy + r * 1.1); ctx.lineTo(cx - r * 0.8, cy + r * 0.6); ctx.lineTo(cx - r, cy - r * 0.5); ctx.closePath(); ctx.stroke();
}

// monitores da agência: texto (roteiro, legenda), arte, linha do tempo do vídeo, checklist da avaliação
const MKT_KINDS = new Set(['mktlead', 'script', 'copy', 'art', 'video', 'critic', 'social']);
function mktScreen(ctx, w, h, robot, s) {
  const rnd = seeded(`${robot.id}${s.piece || s.done}`);
  const pink = '#fb7185';
  ctx.textBaseline = 'top';
  if (robot.kind === 'art') {
    // um post quadrado com título e um "pet"
    const x = w * 0.3, y = h * 0.15, size = Math.min(w * 0.4, h * 0.78);
    ctx.fillStyle = pick2(['#ffb703', '#8ecae6', '#f4a261', '#cdb4db'], rnd); ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#1d1d2b'; ctx.fillRect(x + size * 0.08, y + size * 0.1, size * (0.5 + rnd() * 0.35), size * 0.1);
    ctx.beginPath(); ctx.arc(x + size * 0.5, y + size * 0.62, size * 0.2, 0, Math.PI * 2); ctx.fillStyle = '#ffffffcc'; ctx.fill();
    return;
  }
  if (robot.kind === 'video') {
    // trilhas da linha do tempo de edição e o cursor
    const tracks = [pink, '#38bdf8', '#facc15'];
    tracks.forEach((c, k) => {
      let x = w * 0.05;
      while (x < w * 0.95) {
        const len = w * (0.06 + rnd() * 0.16);
        ctx.fillStyle = rgba(c, 0.75); ctx.fillRect(x, h * (0.4 + k * 0.15), Math.min(len, w * 0.95 - x), h * 0.1);
        x += len + w * 0.012;
      }
    });
    ctx.fillStyle = '#fff'; ctx.fillRect(w * (0.05 + 0.9 * (s.progress || 0)), h * 0.35, 2, h * 0.52);
    ctx.fillStyle = MUTED; ctx.font = `${h * 0.07}px ui-monospace, Consolas, monospace`;
    ctx.fillText(`00:${String(Math.round((s.progress || 0) * 25)).padStart(2, '0')} / 00:25`, w * 0.05, h * 0.18);
    return;
  }
  if (robot.kind === 'critic') {
    ['gancho', 'clareza', 'marca', 'CTA', 'formato'].forEach((k, i) => {
      const y = h * (0.18 + i * 0.15);
      const v = 5 + rnd() * 5;
      ctx.fillStyle = '#c7cbe0'; ctx.font = `${h * 0.08}px system-ui, sans-serif`; ctx.fillText(k, w * 0.05, y);
      bar(ctx, w * 0.32, y + h * 0.02, w * 0.5, h * 0.05, v / 10, v >= 7.5 ? UP : '#f59e0b');
      ctx.fillStyle = MUTED; ctx.fillText(v.toFixed(1), w * 0.86, y);
    });
    return;
  }
  if (robot.kind === 'social' || robot.kind === 'mktlead') {
    // alcance por post / calendário da semana
    for (let k = 0; k < 7; k++) {
      const bh = h * (0.12 + rnd() * 0.6);
      ctx.fillStyle = rgba(k === 6 ? GOLD : pink, 0.75);
      ctx.fillRect(w * (0.08 + k * 0.125), h * 0.9 - bh, w * 0.08, bh);
    }
    return;
  }
  // roteiro e copy: linhas de texto com a primeira em destaque
  ctx.fillStyle = pink; ctx.fillRect(w * 0.06, h * 0.18, w * (0.4 + rnd() * 0.4), h * 0.06);
  for (let k = 0; k < 8; k++) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(w * 0.06, h * (0.32 + k * 0.075), w * (0.3 + rnd() * 0.55), h * 0.035); }
}
const pick2 = (a, rnd) => a[Math.floor(rnd() * a.length)];

function sketch(ctx, w, h, robot, s) {
  const rnd = seeded(`${robot.id}${s.done}`);
  const c = FOCUS[robot.focus].color;
  ctx.strokeStyle = rgba(c, 0.8); ctx.lineWidth = Math.max(1, h / 100);
  if (robot.focus === 'design') {
    // wireframe de tela
    ctx.strokeRect(w * 0.3, h * 0.14, w * 0.4, h * 0.78);
    ctx.fillStyle = rgba(c, 0.5); ctx.fillRect(w * 0.33, h * 0.2, w * 0.34, h * 0.16);
    for (let k = 0; k < 4; k++) { ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(w * 0.33, h * (0.42 + k * 0.1), w * (0.15 + rnd() * 0.19), h * 0.05); }
    ctx.fillStyle = GOLD; ctx.fillRect(w * 0.38, h * 0.82, w * 0.24, h * 0.06);
  } else if (robot.focus === 'ux') {
    // fluxo de telas
    const n = 4;
    for (let k = 0; k < n; k++) {
      const x = w * (0.06 + k * 0.235), y = h * (0.3 + (k % 2) * 0.22);
      ctx.strokeRect(x, y, w * 0.16, h * 0.28);
      if (k < n - 1) { ctx.beginPath(); ctx.moveTo(x + w * 0.16, y + h * 0.14); ctx.lineTo(x + w * 0.235, h * (0.3 + ((k + 1) % 2) * 0.22) + h * 0.14); ctx.stroke(); }
    }
  } else {
    // barras de métrica (tempo de resposta, tamanho de bundle…)
    for (let k = 0; k < 7; k++) {
      const bh = h * (0.15 + rnd() * 0.55);
      ctx.fillStyle = rgba(k === Math.floor(s.progress * 7) ? GOLD : c, 0.75);
      ctx.fillRect(w * (0.08 + k * 0.125), h * 0.9 - bh, w * 0.08, bh);
    }
  }
}

// Monitor esquerdo da mesa: o trabalho em si (board, editor, testes ou rascunho)
export function drawMonitorWork(ctx, w, h, { s, robot, task, board, canvas }) {
  bg(ctx, w, h);
  ctx.fillStyle = robot.color; ctx.fillRect(0, 0, w, Math.max(3, h * 0.03));
  ctx.fillStyle = '#c7cbe0'; ctx.font = `bold ${h * 0.085}px system-ui, sans-serif`; ctx.textBaseline = 'top';
  ctx.fillText(fit(ctx, robot.kind === 'po' ? 'Board · PetLive' : robot.kind === 'canvas' ? 'Canvas · telas x código' : `${robot.name} · ${robot.short}`, w * 0.92), w * 0.04, h * 0.035);
  if (robot.kind === 'po') return kanban(ctx, w * 0.03, h * 0.16, w * 0.94, h * 0.8, board);
  if (robot.kind === 'canvas' && canvas) return canvasMap(ctx, w * 0.04, h * 0.17, w * 0.92, h * 0.8, canvas);
  if (s.status !== 'working') return idleScreen(ctx, w, h, robot);
  if (robot.kind === 'dev' && task) return editor(ctx, w, h, task);
  if (robot.kind === 'qa' && task) return testRunner(ctx, w, h, s, task);
  if (robot.kind === 'sec') return scanner(ctx, w, h, s, task);
  if (robot.kind === 'docs' && task) return editor(ctx, w, h, task);
  if (robot.kind === 'ops' || robot.kind === 'data') return sketch(ctx, w, h, { ...robot, focus: 'dev' }, s);
  if (MKT_KINDS.has(robot.kind)) return mktScreen(ctx, w, h, robot, s);
  if (robot.kind === 'idea') return sketch(ctx, w, h, robot, s);
}

// Monitor direito da mesa: status, task e progresso
export function drawMonitorInfo(ctx, w, h, { s, robot, task }) {
  bg(ctx, w, h, '#080c16');
  const working = s.status === 'working';
  ctx.textBaseline = 'top';
  ctx.fillStyle = working ? UP : MUTED; ctx.font = `bold ${h * 0.1}px system-ui, sans-serif`;
  ctx.fillText(working ? '● TRABALHANDO' : '○ LIVRE', w * 0.05, h * 0.08);
  if (task) {
    ctx.fillStyle = AREA[task.area].color; ctx.font = `bold ${h * 0.16}px system-ui, sans-serif`;
    ctx.fillText(task.id, w * 0.05, h * 0.25);
    ctx.fillStyle = '#e6e8f5'; ctx.font = `${h * 0.095}px system-ui, sans-serif`;
    ctx.fillText(fit(ctx, task.title, w * 0.9), w * 0.05, h * 0.45);
  } else {
    ctx.fillStyle = '#e6e8f5'; ctx.font = `bold ${h * 0.16}px system-ui, sans-serif`;
    ctx.fillText(String(s.done), w * 0.05, h * 0.25);
    ctx.fillStyle = MUTED; ctx.font = `${h * 0.09}px system-ui, sans-serif`;
    ctx.fillText(doneLabel(robot), w * 0.05, h * 0.45);
  }
  if (working) bar(ctx, w * 0.05, h * 0.62, w * 0.9, h * 0.06, s.progress, robot.color);
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.09}px system-ui, sans-serif`;
  ctx.fillText(fit(ctx, s.activity, w * 0.9), w * 0.05, h * 0.76);
}

export const doneLabel = (robot) => ({ po: 'tasks distribuídas', canvas: 'conferências do canvas', ops: 'checagens de produção', docs: 'entregas documentadas', data: 'análises de uso', mktlead: 'pautas e propostas', script: 'roteiros', copy: 'textos e ajustes', art: 'criativos e ajustes', video: 'vídeos e ajustes', critic: 'avaliações', social: 'posts publicados', dev: 'tasks entregues para revisão', sec: 'revisões e auditorias', qa: 'tasks testadas', idea: 'sugestões' }[robot.kind]);

// Tela grande (overlay "abrir tela" e miniaturas): trabalho + task + commits + atividade
export function drawFullScreen(ctx, w, h, { s, robot, task, board, canvas, events }) {
  bg(ctx, w, h);
  const u = h / 540;
  ctx.fillStyle = robot.color; ctx.fillRect(0, 0, w, 8 * u);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e6e8f5'; ctx.font = `bold ${30 * u}px system-ui, sans-serif`;
  ctx.fillText(robot.name, 24 * u, 26 * u);
  ctx.fillStyle = MUTED; ctx.font = `${16 * u}px system-ui, sans-serif`;
  ctx.fillText(robot.roleLabel, 24 * u, 64 * u);
  const working = s.status === 'working';
  ctx.textAlign = 'right';
  ctx.fillStyle = working ? UP : MUTED; ctx.font = `bold ${18 * u}px system-ui, sans-serif`;
  ctx.fillText(working ? '● TRABALHANDO' : '○ LIVRE', w - 24 * u, 26 * u);
  ctx.fillStyle = GOLD; ctx.font = `bold ${17 * u}px system-ui, sans-serif`;
  ctx.fillText(fit(ctx, s.activity, w * 0.4), w - 24 * u, 56 * u);
  ctx.textAlign = 'left';

  // à esquerda, o monitor de trabalho ampliado
  const mw = w * 0.56, mh = h - 130 * u;
  ctx.save(); ctx.translate(24 * u, 104 * u);
  drawMonitorWork(ctx, mw, mh, { s, robot, task, board, canvas });
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.strokeRect(24 * u, 104 * u, mw, mh);

  // à direita, a task e o histórico
  const x0 = 24 * u + mw + 28 * u, cw = w - x0 - 24 * u;
  let y = 104 * u;
  if (task) {
    ctx.fillStyle = AREA[task.area].color; ctx.font = `bold ${22 * u}px system-ui, sans-serif`;
    ctx.fillText(`${task.id} · ${AREA[task.area].label}`, x0, y); y += 30 * u;
    ctx.fillStyle = '#e6e8f5'; ctx.font = `${17 * u}px system-ui, sans-serif`;
    ctx.fillText(fit(ctx, task.title, cw), x0, y); y += 26 * u;
    ctx.fillStyle = MUTED; ctx.font = `${14 * u}px ui-monospace, Consolas, monospace`;
    if (task.branch) { ctx.fillText(fit(ctx, task.branch, cw), x0, y); y += 24 * u; }
    if (working) { bar(ctx, x0, y, cw, 8 * u, s.progress, robot.color); y += 22 * u; }
    ctx.fillStyle = GOLD; ctx.font = `bold ${13 * u}px system-ui, sans-serif`;
    ctx.fillText(`COMMITS (${task.commits.length})`, x0, y); y += 22 * u;
    ctx.font = `${13 * u}px ui-monospace, Consolas, monospace`;
    task.commits.slice(-5).reverse().forEach((c) => {
      ctx.fillStyle = GOLD; ctx.fillText(c.sha.slice(0, 7), x0, y);
      ctx.fillStyle = '#c7cbe0'; ctx.fillText(fit(ctx, c.message, cw - 70 * u), x0 + 70 * u, y);
      y += 21 * u;
    });
    if (!task.commits.length) { ctx.fillStyle = MUTED; ctx.fillText('nenhum ainda', x0, y); y += 21 * u; }
    y += 10 * u;
    if (task.findings?.length) {
      ctx.fillStyle = SEVERITY.alta; ctx.font = `bold ${13 * u}px system-ui, sans-serif`;
      ctx.fillText(`FALHAS DE SEGURANÇA (${task.findings.length})`, x0, y); y += 22 * u;
      ctx.font = `${13 * u}px system-ui, sans-serif`;
      for (const f of task.findings.slice(-3)) {
        ctx.fillStyle = SEVERITY[f.severity] || GOLD; ctx.fillText(f.severity.toUpperCase(), x0, y);
        ctx.fillStyle = f.open ? '#e6e8f5' : MUTED;
        ctx.fillText(fit(ctx, `${f.title}${f.open ? '' : ' · corrigida'}`, cw - 60 * u), x0 + 60 * u, y);
        y += 21 * u;
      }
      y += 10 * u;
    }
  } else {
    ctx.fillStyle = '#e6e8f5'; ctx.font = `bold ${36 * u}px system-ui, sans-serif`;
    ctx.fillText(String(s.done), x0, y); y += 44 * u;
    ctx.fillStyle = MUTED; ctx.font = `${15 * u}px system-ui, sans-serif`;
    ctx.fillText(doneLabel(robot), x0, y); y += 36 * u;
  }
  ctx.fillStyle = GOLD; ctx.font = `bold ${13 * u}px system-ui, sans-serif`;
  ctx.fillText('ATIVIDADE RECENTE', x0, y); y += 22 * u;
  ctx.font = `${13 * u}px system-ui, sans-serif`;
  for (const e of events.slice(-6).reverse()) {
    if (y > h - 24 * u) break;
    ctx.fillStyle = MUTED; ctx.fillText(fmtTime(e.ts), x0, y);
    ctx.fillStyle = '#c7cbe0'; ctx.fillText(fit(ctx, e.message, cw - 52 * u), x0 + 52 * u, y);
    y += 21 * u;
  }
}

// ── painéis das paredes ──
export function drawWallStat(ctx, w, h, { title, value, sub, color = '#f1f3ff' }) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.11}px system-ui, sans-serif`;
  ctx.fillText(fit(ctx, title, w * 0.9), w * 0.05, h * 0.1);
  ctx.fillStyle = color; ctx.font = `bold ${h * 0.34}px system-ui, sans-serif`;
  ctx.fillText(fit(ctx, value, w * 0.9), w * 0.05, h * 0.3);
  ctx.fillStyle = '#9aa0c0'; ctx.font = `${h * 0.12}px system-ui, sans-serif`;
  ctx.fillText(fit(ctx, sub, w * 0.9), w * 0.05, h * 0.78);
}

export function drawWallClock(ctx, w, h, date, subtitle) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.11}px system-ui, sans-serif`;
  ctx.fillText(subtitle, w * 0.05, h * 0.1);
  ctx.fillStyle = '#f1f3ff'; ctx.font = `bold ${h * 0.4}px ui-monospace, Consolas, monospace`;
  ctx.fillText(fmtClock(date), w * 0.05, h * 0.3);
  ctx.fillStyle = '#9aa0c0'; ctx.font = `${h * 0.12}px system-ui, sans-serif`;
  ctx.fillText(date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }), w * 0.05, h * 0.78);
}

export function drawWallChart(ctx, w, h, series, title) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.08}px system-ui, sans-serif`;
  ctx.fillText(title, w * 0.04, h * 0.07);
  chart(ctx, w * 0.04, h * 0.22, w * 0.92, h * 0.7, series);
}

export function drawWallBoard(ctx, w, h, board) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.08}px system-ui, sans-serif`;
  ctx.fillText('BOARD DO GITHUB · PETLIVE', w * 0.04, h * 0.07);
  kanban(ctx, w * 0.03, h * 0.2, w * 0.94, h * 0.74, board);
}

// lista curta na parede: relatórios do QA ou sugestões de melhoria
export function drawWallList(ctx, w, h, title, items) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.08}px system-ui, sans-serif`;
  ctx.fillText(title, w * 0.04, h * 0.07);
  ctx.font = `${h * 0.07}px system-ui, sans-serif`;
  if (!items.length) { ctx.fillStyle = MUTED; ctx.fillText('Nada ainda', w * 0.04, h * 0.25); return; }
  items.slice(-6).reverse().forEach((it, k) => {
    const y = h * (0.22 + k * 0.125);
    ctx.fillStyle = it.color; ctx.fillRect(w * 0.04, y + h * 0.015, w * 0.012, h * 0.06);
    ctx.fillStyle = it.color; ctx.font = `bold ${h * 0.07}px system-ui, sans-serif`;
    ctx.fillText(it.tag, w * 0.07, y);
    const tw = ctx.measureText(it.tag).width;
    ctx.fillStyle = '#d5d7ee'; ctx.font = `${h * 0.07}px system-ui, sans-serif`;
    ctx.fillText(fit(ctx, it.text, w * 0.86 - tw), w * 0.09 + tw, y);
  });
}

export function drawLogo(ctx, w, h, text, caption) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = w * 0.42;
  const hex = (rad) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } ctx.closePath(); };
  hex(r); ctx.fillStyle = '#0d0f17'; ctx.fill();
  hex(r); ctx.strokeStyle = GOLD; ctx.lineWidth = w * 0.035; ctx.stroke();
  hex(r * 0.78); ctx.strokeStyle = 'rgba(255,196,0,0.45)'; ctx.lineWidth = w * 0.012; ctx.stroke();
  ctx.fillStyle = GOLD; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${w * 0.22}px system-ui, sans-serif`; ctx.fillText(text, cx, cy - h * 0.02);
  ctx.font = `bold ${w * 0.065}px system-ui, sans-serif`; ctx.fillText(caption, cx, cy + h * 0.17);
  ctx.textAlign = 'left';
}

export function drawRug(ctx, w, h, label) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(30,26,12,0.92)'; ctx.fillRect(0, 0, w, h);
  ctx.setLineDash([22, 14]); ctx.strokeStyle = GOLD; ctx.lineWidth = 6; ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,196,0,0.5)'; ctx.font = `bold ${h * 0.17}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
  ctx.fillText(label, 36, h / 2);
}
