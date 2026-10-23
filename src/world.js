// Cena: um salão voxel com paredes neon amarelas, dividido em duas alas (fundo e frente). Cada ala
// tem as suas zonas (mesas com dois monitores e o painel do time na parede ou na divisória de vidro),
// o corredor e a área de descanso. Robô trabalhando fica na mesa; livre vai para o sofá em frente à
// sua zona; em reunião, para a sala de reunião. Para mudar de ala, usa o corredor junto à parede esquerda.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { M, glow, box, canvasTex, screenPlane, blobShadow, YELLOW } from './common.js';
import { makeBot } from './robot.js';
import {
  AREA, FOCUS, SEVERITY, pct, drawCanvasWall, drawMonitorWork, drawMonitorInfo, drawWallStat, drawWallClock, drawWallChart, drawWallBoard, drawWallList, drawLogo, drawRug,
} from './screens.js';
import { OFFICE } from './data/robots.js';
import { planPath } from './paths.js';

const STEP = 4.8;       // distância entre mesas (x)
const ZONE_MIN = 12;    // largura mínima de uma zona: cabem os dois painéis de parede
const ZONE_GAP = 2.4;   // corredor entre zonas
const MARGIN = 2;       // folga até a parede da direita
const SIDE = 3.4;       // corredor junto à parede esquerda, por onde se passa de uma ala para a outra
const HALF = 11;        // meia profundidade de uma ala (z local vai de -HALF a HALF)
const BETWEEN = 3;      // passagem entre as alas
// coordenadas dentro de uma ala (a parede ou divisória fica em -HALF)
const ROWS_Z = [-7.2, -2.0];
const AISLE_Z = 2.4;    // corredor por onde os robôs andam entre mesas e descanso
const SOFA_Z = 6.8;
const SPEED = 5.5;
const MEET_W = 11;      // sala de reunião, no fim da ala da frente

// Divide as zonas (e a sala de reunião, por último) em duas alas na ordem do fluxo, equilibrando as
// larguras. Cada zona recebe x (centro) e oz (deslocamento em z da sua ala).
function zoneLayout(floors, robots) {
  const items = floors.map((fl) => {
    const count = robots.filter((r) => r.floor === fl.id).length;
    const cols = Math.max(1, Math.ceil(count / 2));
    return { id: fl.id, cols, w: Math.max(cols * STEP, ZONE_MIN) };
  });
  items.push({ id: 'meet', cols: 0, w: MEET_W });
  const width = (list) => list.reduce((n, z) => n + z.w, 0) + ZONE_GAP * Math.max(0, list.length - 1);
  let split = 1;
  for (let k = 1; k < items.length; k++) {
    if (Math.max(width(items.slice(0, k)), width(items.slice(k))) < Math.max(width(items.slice(0, split)), width(items.slice(split)))) split = k;
  }
  const rows = [items.slice(0, split), items.slice(split)];
  const FX = (Math.max(...rows.map(width)) + SIDE + MARGIN) / 2;
  const FZ = HALF * rows.length + (BETWEEN * (rows.length - 1)) / 2;
  const bands = rows.map((list, r) => {
    const oz = -FZ + HALF + r * (2 * HALF + BETWEEN);
    let x = -FX + SIDE;
    for (const z of list) { Object.assign(z, { x: x + z.w / 2, oz, band: r }); x += z.w + ZONE_GAP; }
    return { oz, x0: -FX + SIDE, x1: x - ZONE_GAP };
  });
  const meet = items.find((z) => z.id === 'meet');
  return { zones: new Map(items.filter((z) => z !== meet).map((z) => [z.id, z])), meet, bands, FX, FZ };
}

// cores do salão em cada tema (o neon e os monitores são iguais nos dois)
const THEMES = {
  dark: { tiles: ['#3a3d4b', '#454959'], wall: 0x353846, slat: 0x272a37, slab: 0x12131a, frame: 0x2b2e3b, glass: 0.1 },
  light: { tiles: ['#c9cdd8', '#d6d9e2'], wall: 0xb9bdca, slat: 0xa6abba, slab: 0x8d92a3, frame: 0x8a8fa0, glass: 0.18 },
};

function drawTiles(c, [a, b]) {
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 128, 128);
  g.fillStyle = b; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64); g.strokeRect(64, 0, 64, 64); g.strokeRect(0, 64, 64, 64);
}

function floorTexture(FX, FZ) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  drawTiles(c, THEMES.dark.tiles);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(FX, FZ);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function deskLayout(zone, slot) {
  const row = Math.floor(slot / zone.cols), col = slot % zone.cols;
  return { x: zone.x + (col - (zone.cols - 1) / 2) * STEP, z: zone.oz + ROWS_Z[row] };
}

function sofaLayout(zone, slot) {
  const sofas = zone.cols;
  const sx = zone.x + (Math.floor(slot / 2) - (sofas - 1) / 2) * STEP;
  return { sofaX: sx, x: sx + (slot % 2 ? 0.85 : -0.85), z: zone.oz + SOFA_Z };
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false });

export function buildWorld(scene, floors, robots, { feed, camera }) {
  const getState = (id) => feed.getState(id);
  const { zones, meet, bands, FX, FZ } = zoneLayout(floors, robots);
  const floorMap = new Map();
  const actors = new Map();
  const hits = [];
  // painéis de parede clicáveis: id → { id, title, ct, draw(ctx, w, h), open }. `open` é o painel
  // da interface que o clique abre (board, canvas, relatórios…); sem ele, abre o próprio painel ampliado.
  const panels = new Map();

  const g = new THREE.Group();
  scene.add(g);

  const makeScreen = (w, h, cw, ch, x, y, z, rotY, framed = true) => {
    const ct = canvasTex(cw, ch);
    if (framed) {
      const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = rotY; g.add(f);
      box(f, w + 0.3, h + 0.3, 0.12, glow(YELLOW, 1.5), 0, 0, -0.1, { cast: false });
    }
    ct.mesh = screenPlane(g, w, h, ct, x, y, z, rotY);
    return ct;
  };
  function addPanel(id, title, { w, h, cw, ch, x, y, z, rotY = 0, draw, open = null }) {
    const ct = makeScreen(w, h, cw, ch, x, y, z, rotY);
    ct.mesh.userData.panel = id;
    hits.push(ct.mesh);
    panels.set(id, { id, title, ct, draw, open });
  }

  // piso + laje
  const room = {
    slab: new THREE.MeshStandardMaterial({ color: THEMES.dark.slab, roughness: 0.85 }),
    wall: new THREE.MeshStandardMaterial({ color: THEMES.dark.wall, roughness: 0.85 }),
    slat: new THREE.MeshStandardMaterial({ color: THEMES.dark.slat, roughness: 0.85 }),
    frame: new THREE.MeshStandardMaterial({ color: THEMES.dark.frame, roughness: 0.85 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTexture(FX, FZ), roughness: 0.9 }),
  };
  box(g, FX * 2 + 0.6, 0.9, FZ * 2 + 0.6, room.slab, 0, -0.45, 0, { cast: false });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(FX * 2, FZ * 2), room.floor);
  top.rotation.x = -Math.PI / 2; top.position.y = 0.01; top.receiveShadow = true; g.add(top);
  box(g, FX * 2 + 0.6, 0.2, 0.24, glow(YELLOW), 0, 0.02, FZ + 0.3, { cast: false });
  box(g, 0.24, 0.2, FZ * 2 + 0.6, glow(YELLOW), FX + 0.3, 0.02, 0, { cast: false });

  // paredes (fundo e esquerda), ripadas, com friso neon no topo
  const wallM = room.wall, slatM = room.slat;
  box(g, FX * 2 + 0.6, 5.6, 0.5, wallM, 0, 2.8, -FZ - 0.25, { cast: false });
  box(g, 0.5, 5.6, FZ * 2 + 0.6, wallM, -FX - 0.25, 2.8, 0, { cast: false });
  for (let x = -FX + 0.75; x < FX; x += 1.5) box(g, 0.5, 4.8, 0.14, slatM, x, 2.55, -FZ + 0.07, { cast: false });
  for (let z = -FZ + 0.75; z < FZ; z += 1.5) box(g, 0.14, 4.8, 0.5, slatM, -FX + 0.07, 2.55, z, { cast: false });
  box(g, FX * 2 + 0.6, 0.18, 0.34, glow(YELLOW), 0, 5.62, -FZ - 0.25, { cast: false });
  box(g, 0.34, 0.18, FZ * 2 + 0.6, glow(YELLOW), -FX - 0.25, 5.62, 0, { cast: false });
  box(g, 0.34, 5.6, 0.34, glow(YELLOW), -FX - 0.25, 2.8, -FZ - 0.25, { cast: false });
  box(g, FX * 2 + 0.6, 0.14, 0.3, glow(YELLOW, 1.2), 0, 0.3, -FZ - 0.2, { cast: false });
  box(g, 0.3, 0.14, FZ * 2 + 0.6, glow(YELLOW, 1.2), -FX - 0.2, 0.3, 0, { cast: false });

  // parede esquerda: board do GitHub na altura da ala do fundo; relógio e logo na da frente
  addPanel('board', 'Board do GitHub', { w: 14, h: 3.8, cw: 1000, ch: 270, x: -FX + 0.3, y: 3.0, z: bands[0].oz - 2.2, rotY: Math.PI / 2, open: 'board', draw: (ctx, w, h) => drawWallBoard(ctx, w, h, feed.board) });
  const front = bands.at(-1).oz;
  addPanel('clock', 'Relógio', { w: 5.4, h: 2.9, cw: 520, ch: 280, x: -FX + 0.3, y: 3.0, z: front - 3.4, rotY: Math.PI / 2, draw: (ctx, w, h) => drawWallClock(ctx, w, h, new Date(), OFFICE.title.toUpperCase()) });
  const logo = canvasTex(256, 256);
  drawLogo(logo.ctx, 256, 256, OFFICE.logo, OFFICE.title.toUpperCase());
  logo.tex.needsUpdate = true;
  screenPlane(g, 3.4, 3.4, logo, -FX + 0.25, 3.0, front + 3.4, Math.PI / 2, true);

  // por ala: divisória de vidro (as alas da frente), tapete da área de descanso e a placa do corredor lateral
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.1, roughness: 0.1, metalness: 0.2, depthWrite: false });
  bands.forEach((b, i) => {
    const len = b.x1 - b.x0 + 2;
    const cx = (b.x0 + b.x1) / 2;
    if (i > 0) {
      const wz = b.oz - HALF - 0.1;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(len, 5.0, 0.12), glass);
      pane.position.set(cx, 2.5, wz); g.add(pane);
      box(g, len, 0.16, 0.3, glow(YELLOW, 1.4), cx, 5.05, wz, { cast: false });
      box(g, len, 0.3, 0.4, room.frame, cx, 0.15, wz, { cast: false });
      for (let x = b.x0 - 1; x <= b.x1 + 1.01; x += (len - 0.01) / Math.max(1, Math.round(len / 7))) box(g, 0.18, 5.0, 0.18, room.frame, x, 2.5, wz, { cast: false });
    }
    const rug = canvasTex(2048, 150);
    drawRug(rug.ctx, 2048, 150, 'ÁREA DE DESCANSO · ROBÔS LIVRES');
    rug.tex.needsUpdate = true;
    const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(len - 2, 3.8), new THREE.MeshBasicMaterial({ map: rug.tex, transparent: true, toneMapped: false }));
    rugMesh.rotation.x = -Math.PI / 2; rugMesh.position.set(cx, 0.04, b.oz + SOFA_Z + 0.4); g.add(rugMesh);
  });
  // faixa do corredor lateral, que liga as alas
  box(g, 0.1, 0.03, FZ * 2 - 2, glow(YELLOW, 0.6), -FX + SIDE - 0.6, 0.03, 0, { cast: false });

  // painéis de cada zona: o da esquerda é o número do time, o da direita muda por time
  const working = (F) => F.robots.filter((r) => getState(r.id).status === 'working').length;
  const sum = (F, k) => F.robots.reduce((n, r) => n + getState(r.id)[k], 0);
  const count = (col) => feed.board.filter((t) => t.column === col).length;
  const findings = () => feed.board.flatMap((t) => (t.findings || []).map((f) => ({ ...f, task: t })));
  const people = (F) => {
    const busy = working(F);
    return `${busy} trabalhando · ${F.robots.length - busy} ${F.cfg.id === 'lab' ? 'em pausa' : 'livres'}`;
  };
  const statPanel = (title, stat, open = null) => ({ title, open, draw: (ctx, w, h) => drawWallStat(ctx, w, h, stat()) });

  function zonePanels(F) {
    switch (F.cfg.id) {
      case 'po': return [
        statPanel('Produto · backlog', () => ({ title: 'PRODUTO · BACKLOG', value: `${count('todo') + count('refining')} tasks`, sub: `${count('dev') + count('rework')} em dev · ${count('security')} em segurança · ${count('qa')} em QA` }), 'board'),
        { id: 'canvas', title: `Canvas · ${feed.canvas?.title || 'design'}`, open: 'canvas', cw: 900, ch: 520, draw: (ctx, w, h) => feed.canvas && drawCanvasWall(ctx, w, h, feed.canvas) },
      ];
      case 'dev': return [
        statPanel('Desenvolvimento · commits', () => ({ title: 'DESENVOLVIMENTO · COMMITS', value: String(sum(F, 'commits')), sub: people(F) })),
        { title: 'Entregas acumuladas', draw: (ctx, w, h) => drawWallChart(ctx, w, h, feed.delivered, 'ENTREGAS ACUMULADAS') },
      ];
      case 'sec': return [
        statPanel('Segurança · falhas em correção', () => {
          const all = findings();
          return { title: 'SEGURANÇA · FALHAS EM CORREÇÃO', value: String(all.filter((f) => f.open).length), sub: `${all.filter((f) => !f.open).length} corrigidas · ${count('security')} na fila de revisão` };
        }),
        { title: 'Falhas encontradas', draw: (ctx, w, h) => drawWallList(ctx, w, h, 'FALHAS ENCONTRADAS', findings().map((f) => ({ tag: f.severity.toUpperCase(), color: SEVERITY[f.severity], text: `${f.task.id} · ${f.title}${f.open ? '' : ' ✔'}` }))) },
      ];
      case 'ops': return [
        statPanel('Operações · produção', () => {
          const last = feed.releases?.at(-1);
          const waiting = feed.board.filter((t) => t.column === 'merged' && !t.released && !t.alreadyDone).length;
          return { title: `PRODUÇÃO · ${OFFICE.productionBranch.toUpperCase()}`, value: last ? last.version : 'sem release', sub: `${waiting} entrega(s) em ${OFFICE.baseBranch} esperando release` };
        }, 'releases'),
        { title: 'Produção e changelog', open: 'releases', draw: (ctx, w, h) => drawWallList(ctx, w, h, 'ERROS · CHANGELOG', [
          ...(feed.changelog || []).slice(-4).map((c) => ({ tag: c.kind.toUpperCase(), color: c.kind === 'Novo' ? '#34d399' : '#38bdf8', text: c.text.replace(/^\w+: /, '') })),
          ...(feed.incidents || []).slice(-3).map((i) => ({ tag: 'ERRO', color: SEVERITY[i.severity], text: `${i.error} · ${i.count}×` })),
        ]) },
      ];
      case 'mkt': return [
        statPanel('Marketing · publicados', () => {
          const pieces = feed.marketing?.pieces || [];
          const live = pieces.filter((p) => p.metrics);
          const reach = live.reduce((n, p) => n + p.metrics.reach, 0);
          const waiting = pieces.filter((p) => p.stage === 'aprovação').length
            + feed.ideas.filter((i) => i.focus === 'divulgação' && i.status === 'aguardando').length;
          return { title: 'MARKETING · PUBLICADOS', value: String(live.length), sub: `${reach.toLocaleString('pt-BR')} de alcance · ${waiting} esperando você` };
        }, 'marketing'),
        { title: 'Próximos posts', open: 'marketing', draw: (ctx, w, h) => drawWallList(ctx, w, h, 'PRÓXIMOS POSTS',
          (feed.marketing?.pieces || []).filter((p) => !['publicado', 'recusado'].includes(p.stage)).map((p) => ({
            tag: p.stage.toUpperCase(), color: p.stage === 'aprovação' ? '#ffc400' : p.stage === 'agendado' ? '#34d399' : '#fb7185', text: `${p.format} · ${p.hook}`,
          }))) },
      ];
      case 'qa': return [
        statPanel('QA · entregas', () => ({ title: `QA · ENTREGUES EM ${OFFICE.baseBranch.toUpperCase()}`, value: String(feed.delivered.at(-1) ?? 0), sub: people(F) }), 'reports'),
        { title: 'Últimos relatórios', open: 'reports', draw: (ctx, w, h) => drawWallList(ctx, w, h, 'ÚLTIMOS RELATÓRIOS', feed.reports.map((r) => ({ tag: r.taskId, color: AREA[r.area].color, text: `${r.title} · ${r.tests.passed}/${r.tests.total}` }))) },
      ];
      default: return [
        // posts e divulgação são da agência: contam no painel do Marketing, não nas melhorias
        statPanel('Melhorias · aguardando você', () => {
          const ideas = feed.ideas.filter((i) => !['post', 'divulgação'].includes(i.focus));
          return { title: 'MELHORIAS · AGUARDANDO VOCÊ', value: String(ideas.filter((i) => i.status === 'aguardando').length), sub: `${ideas.filter((i) => i.status === 'aprovada').length} aprovadas · ${people(F)}` };
        }, 'ideas'),
        { title: 'Últimas sugestões', open: 'ideas', draw: (ctx, w, h) => drawWallList(ctx, w, h, 'ÚLTIMAS SUGESTÕES', feed.ideas.filter((i) => !['post', 'divulgação'].includes(i.focus)).map((i) => ({ tag: FOCUS[i.focus].label, color: FOCUS[i.focus].color, text: `${i.status === 'aguardando' ? '⏳' : i.status === 'aprovada' ? '✔' : '✕'} ${i.title}` }))) },
      ];
    }
  }

  // sala de reunião: mesa comprida com cadeiras; P.O, dev e revisor vêm para cá quando uma task volta duas vezes
  const TABLE_Z = -4.2;
  const meetSeats = [];
  {
    const mg = new THREE.Group(); mg.position.set(meet.x, 0, meet.oz); g.add(mg);
    for (const sx of [-1, 1]) box(mg, 0.1, 0.03, AISLE_Z + HALF - 1.2, glow(YELLOW, 0.7), sx * (meet.w / 2 + 0.2), 0.03, (AISLE_Z - HALF) / 2 - 0.6, { cast: false });
    blobShadow(mg, 8, 4.5, 0.35, 0, TABLE_Z);
    box(mg, 6.4, 0.16, 2.2, M(0x4a3f2a), 0, 0.98, TABLE_Z);
    box(mg, 6.0, 0.04, 0.06, glow(YELLOW, 1.1), 0, 1.07, TABLE_Z + 1.1, { cast: false });
    for (const lx of [-2.8, 2.8]) box(mg, 0.2, 0.95, 1.6, M(0x2c2f3d), lx, 0.48, TABLE_Z);
    // três cadeiras de cada lado da mesa
    for (const [i, sx] of [-2, 0, 2].entries()) {
      for (const side of [-1, 1]) {
        const z = TABLE_Z + side * 1.75;
        box(mg, 0.9, 0.14, 0.9, M(0x1f2130), sx, 0.5, z);
        box(mg, 0.9, 0.5, 0.1, M(0x3a3f55), sx, 0.85, z + side * 0.45);
        meetSeats.push({ x: meet.x + sx, z: meet.oz + z, rot: side > 0 ? Math.PI : 0, order: i * 2 + (side > 0 ? 1 : 0), band: meet.band });
      }
    }
    meetSeats.sort((a, b) => a.order - b.order);
    const sign = canvasTex(640, 90);
    drawRug(sign.ctx, 640, 90, 'SALA DE REUNIÃO');
    sign.tex.needsUpdate = true;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(meet.w - 1, 10), 1.4), new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true, toneMapped: false }));
    signMesh.rotation.x = -Math.PI / 2; signMesh.position.set(meet.x, 0.04, meet.oz + AISLE_Z + 1.4); g.add(signMesh);
    const pl = new THREE.PointLight(0xffb300, 14, 18, 1.8);
    pl.position.set(meet.x, 5, meet.oz + TABLE_Z);
    g.add(pl);
  }
  addPanel('meeting', 'Sala de reunião', {
    w: meet.w - 1.4, h: 3.1, cw: 720, ch: 300, x: meet.x, y: 3.0, z: meet.oz - HALF + 0.3, open: 'board',
    draw: (ctx, w, h) => {
      const m = feed.meeting;
      const t = m && feed.task(m.taskId);
      drawWallStat(ctx, w, h, m && t
        ? { title: 'SALA DE REUNIÃO · EM ANDAMENTO', value: `${t.id} · ${t.title}`, sub: `${m.robots.join(', ')} · voltou ${t.rework} vezes` }
        : { title: 'SALA DE REUNIÃO', value: 'Livre', sub: 'Task que volta duas vezes junta P.O, dev e revisor aqui', color: '#9aa0c0' });
    },
  });

  for (const fl of floors) {
    const zone = zones.get(fl.id);
    const mine = robots.filter((r) => r.floor === fl.id);
    const F = { cfg: fl, zone, robots: mine, balloons: [] };
    floorMap.set(fl.id, F);

    // demarcação da zona no piso: faixa neon nas laterais e placa com o nome no corredor
    for (const sx of [-1, 1]) box(g, 0.1, 0.03, AISLE_Z + HALF - 1.2, glow(YELLOW, 0.7), zone.x + sx * (zone.w / 2 + 0.2), 0.03, zone.oz + (AISLE_Z - HALF) / 2 - 0.6, { cast: false });
    const sign = canvasTex(640, 90);
    drawRug(sign.ctx, 640, 90, `${fl.label} · ${fl.name.toUpperCase()}`);
    sign.tex.needsUpdate = true;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(zone.w - 1, 10), 1.4), new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true, toneMapped: false }));
    signMesh.rotation.x = -Math.PI / 2; signMesh.position.set(zone.x, 0.04, zone.oz + AISLE_Z + 1.4); g.add(signMesh);

    // painéis do time na parede do fundo (ou na divisória de vidro, na ala da frente): o número do time e um painel que muda por time
    const pw = (zone.w - 1.4) / 2;
    const [left, right] = zonePanels(F);
    const wallZ = zone.oz - HALF + 0.3;
    addPanel(`${fl.id}-stat`, left.title, { w: pw, h: 3.1, cw: 520, ch: 300, x: zone.x - pw / 2 - 0.35, y: 3.0, z: wallZ, draw: left.draw, open: left.open });
    addPanel(right.id || `${fl.id}-panel`, right.title, { w: pw, h: 3.1, cw: right.cw || 520, ch: right.ch || 300, x: zone.x + pw / 2 + 0.35, y: 3.0, z: wallZ, draw: right.draw, open: right.open });

    // sofás da zona
    for (let i = 0; i < zone.cols; i++) {
      const sx = zone.x + (i - (zone.cols - 1) / 2) * STEP;
      const sm = M(0x3a3320), sb = M(0x2c2718);
      box(g, 3.5, 0.55, 1.3, sm, sx, 0.3, zone.oz + SOFA_Z);
      box(g, 3.5, 1.1, 0.3, sb, sx, 0.85, zone.oz + SOFA_Z - 0.55);
      box(g, 0.3, 0.9, 1.3, sb, sx - 1.75, 0.55, zone.oz + SOFA_Z);
      box(g, 0.3, 0.9, 1.3, sb, sx + 1.75, 0.55, zone.oz + SOFA_Z);
      box(g, 3.1, 0.1, 0.1, glow(YELLOW, 1.2), sx, 0.12, zone.oz + SOFA_Z + 0.7, { cast: false });
      box(g, 0.7, 0.45, 0.7, M(0x2a2a33), sx + 2.65, 0.22, zone.oz + SOFA_Z + 0.8); // pufe
    }

    // luz de ambiente da zona
    const pl = new THREE.PointLight(0xffb300, 18, 22, 1.8);
    pl.position.set(zone.x, 5, zone.oz - 2);
    g.add(pl);

    // mesas + robôs
    for (const r of mine) {
      const d = deskLayout(zone, r.slot);
      const sofa = sofaLayout(zone, r.slot);
      const st = getState(r.id);

      const desk = new THREE.Group(); desk.position.set(d.x, 0, d.z); g.add(desk);
      blobShadow(desk, 5, 3, 0.35);
      box(desk, 3.5, 0.14, 1.5, M(0x6a6f84), 0, 0.92, 0);
      box(desk, 0.12, 0.9, 1.3, M(0x2c2f3d), -1.6, 0.45, 0);
      box(desk, 0.12, 0.9, 1.3, M(0x2c2f3d), 1.6, 0.45, 0);
      box(desk, 3.5, 0.5, 0.1, M(0x2c2f3d), 0, 0.7, -0.6);
      box(desk, 1.1, 0.04, 0.4, M(0x0e0f15), 0, 1.01, 0.38);
      box(desk, 1.0, 0.02, 0.06, glow(r.color, 1.4), 0, 1.04, 0.52, { cast: false });
      box(desk, 3.5, 0.04, 0.06, glow(YELLOW, 1.1), 0, 0.95, 0.76, { cast: false });
      // cadeira
      box(desk, 0.95, 0.14, 0.95, M(0x1f2130), 0, 0.5, 1.25);
      box(desk, 0.14, 0.45, 0.14, M(0x14151d), 0, 0.25, 1.25);
      box(desk, 0.95, 0.5, 0.1, M(r.color), 0, 0.85, 1.72);

      // dois monitores
      const screens = [];
      for (const [i, sx] of [-0.9, 0.9].entries()) {
        const mon = new THREE.Group();
        mon.position.set(sx, 0, -0.35);
        mon.rotation.y = i === 0 ? 0.2 : -0.2;
        desk.add(mon);
        box(mon, 0.2, 0.3, 0.2, M(0x14151d), 0, 1.15, 0);
        const bezel = box(mon, 1.7, 1.06, 0.12, M(0x0e0f15), 0, 1.78, 0);
        bezel.userData.robotId = r.id;
        hits.push(bezel);
        const ct = canvasTex(320, 200);
        const plane = screenPlane(mon, 1.58, 0.94, ct, 0, 1.78, 0.07);
        plane.userData.robotId = r.id;
        hits.push(plane);
        screens.push(ct);
      }

      // robô
      const bot = makeBot(r.color);
      g.add(bot.root);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.0, 1.4), hitMat);
      hit.position.y = 1.4; hit.userData.robotId = r.id;
      bot.root.add(hit);
      hits.push(hit);
      blobShadow(bot.root, 1.8, 1.8, 0.4);

      // balão com nome, task e atividade
      const el = document.createElement('div');
      el.className = 'bubble';
      el.dataset.robot = r.id;
      el.innerHTML = '<div class="b-top"><i class="b-dot"></i><b class="b-name"></b><span class="b-flag"></span></div><div class="b-task"></div><div class="b-activity"></div>';
      const label = new CSS2DObject(el);
      label.position.set(0, r.slot % 2 ? 4.5 : 3.5, 0); // alterna a altura para os balões da fileira de descanso não se sobreporem
      bot.root.add(label);

      const actor = {
        id: r.id, robot: r, floor: fl, bot, screens, el, label,
        desk: { x: d.x, z: d.z + 1.25, rot: Math.PI, band: zone.band },
        deskPos: new THREE.Vector3(d.x, 1.8, d.z),
        rest: { x: sofa.x, z: sofa.z, rot: 0, band: zone.band },
        band: zone.band,
        pos: new THREE.Vector3(), path: [], rot: 0, seated: false, status: null,
        taskEl: el.querySelector('.b-task'), activityEl: el.querySelector('.b-activity'), nameEl: el.querySelector('.b-name'), dotEl: el.querySelector('.b-dot'), flagEl: el.querySelector('.b-flag'),
      };
      actor.nameEl.textContent = r.name;
      actors.set(r.id, actor);
      F.balloons.push(actor);

      // posição inicial sem animação
      const st0 = st?.status === 'working' ? actor.desk : actor.rest;
      actor.pos.set(st0.x, 0, st0.z); actor.rot = st0.rot; actor.status = st?.status || 'idle';
      bot.root.position.copy(actor.pos); bot.root.rotation.y = actor.rot;
    }
  }

  // destino de cada estado: mesa, sofá ou cadeira da sala de reunião
  const targetOf = (a) => (a.status === 'working' ? a.desk : a.status === 'meeting' && a.seat ? a.seat : a.rest);
  function setActorStatus(a, status, seat = null) {
    if (a.status === status && a.seat === seat) return;
    a.status = status;
    a.seat = seat;
    const target = targetOf(a);
    a.path = planPath({ x: a.pos.x, z: a.pos.z, band: a.band }, target, pathLayout);
    a.band = target.band;
  }
  const pathLayout = { aisles: bands.map((b) => b.oz + AISLE_Z), sideX: -FX + SIDE / 2 };

  // ── desempenho: só redesenha o que mudou e está na tela; o resto fica marcado para quando aparecer ──
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  function refreshFrustum() {
    if (!camera) return;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
  }
  const onScreen = (pos, radius) => {
    if (!camera) return true;
    sphere.center.copy(pos);
    sphere.radius = radius;
    return frustum.intersectsSphere(sphere);
  };
  const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  function drawMonitors(a, view) {
    const [c1, c2] = a.screens;
    drawMonitorWork(c1.ctx, c1.w, c1.h, view); c1.tex.needsUpdate = true;
    drawMonitorInfo(c2.ctx, c2.w, c2.h, view); c2.tex.needsUpdate = true;
    a.dirty = false;
  }
  function drawPanel(p) {
    p.draw(p.ct.ctx, p.ct.w, p.ct.h); p.ct.tex.needsUpdate = true;
    p.dirty = false;
  }
  let frame = 0;
  for (const p of panels.values()) { p.center = p.ct.mesh.getWorldPosition(new THREE.Vector3()); p.radius = p.ct.mesh.geometry.parameters.width / 2 + 0.5; }

  let currentZone = null;
  const world = {
    floors: floorMap, actors, hits, FX, FZ,
    // planta do salão para o mapa pequeno: retângulo de cada zona (x, z, largura, profundidade)
    plan: {
      FX, FZ,
      zones: floors.map((fl) => { const z = zones.get(fl.id); return { id: fl.id, label: fl.label, name: fl.name, x: z.x, z: z.oz, w: z.w, d: HALF * 2 }; }),
      meet: { x: meet.x, z: meet.oz, w: meet.w, d: HALF * 2 },
    },
    // tema claro ou escuro: troca as cores do piso, das paredes e o vidro da divisória
    setTheme(name) {
      const t = THEMES[name] || THEMES.dark;
      room.slab.color.setHex(t.slab); room.wall.color.setHex(t.wall); room.slat.color.setHex(t.slat); room.frame.color.setHex(t.frame);
      drawTiles(room.floor.map.image, t.tiles);
      room.floor.map.needsUpdate = true;
      glass.opacity = t.glass;
    },
    zone: (id) => zones.get(id),
    panel: (id) => panels.get(id),
    get current() { return currentZone; },
    setFloor(id) { currentZone = id; },

    // aplica o estado atual do feed nas telas, balões e destino de cada robô
    sync() {
      refreshFrustum();
      // assinaturas do board e do canvas: o monitor do P.O e do CANVAS_01 só muda quando elas mudam
      const boardSig = feed.board.map((t) => t.column[0]).join('');
      const canvasSig = feed.canvas ? feed.canvas.screens.map((sc) => (sc.outdated ? 'o' : sc.status[0])).join('') : '';
      for (const a of actors.values()) {
        const s = getState(a.id);
        const task = s.taskId ? feed.task(s.taskId) : null;
        const working = s.status === 'working';
        const seatIdx = s.status === 'meeting' ? feed.meeting?.robots.indexOf(a.id) ?? -1 : -1;
        setActorStatus(a, s.status, seatIdx >= 0 ? meetSeats[seatIdx % meetSeats.length] : null);
        // indicador sobre o robô: pausado, em reunião, travado ou dormindo
        const stuck = /^Aguardando/.test(s.activity) || (task && task.rework >= 2 && s.status !== 'meeting');
        const flag = s.paused || feed.paused ? ['⏸', 'paused'] : s.status === 'meeting' ? ['💬', 'meeting'] : stuck ? ['⚠', 'stuck'] : !working ? ['z', 'sleep'] : ['', ''];
        setText(a.flagEl, flag[0]);
        if (a.flagEl.className !== `b-flag ${flag[1]}`) a.flagEl.className = `b-flag ${flag[1]}`;
        setText(a.taskEl, task ? `${task.id} · ${s.status === 'meeting' ? 'reunião' : pct(s.progress)}` : working ? pct(s.progress) : s.activity);
        a.taskEl.style.color = task ? AREA[task.area].color : '';
        const busy = working || s.status === 'meeting';
        setText(a.activityEl, busy ? s.activity : '');
        a.activityEl.style.display = busy ? '' : 'none';
        a.el.classList.toggle('rest', !busy);
        a.dotEl.style.background = working ? '#4ade80' : '#6b7090';
        const key = [s.status, s.activity, s.taskId, Math.round(s.progress * 20), task?.commits.length, task?.findings?.length, s.done, s.paused, s.piece,
          a.robot.kind === 'po' ? boardSig : '', a.robot.kind === 'canvas' ? canvasSig : ''].join('|');
        if (key !== a.key) { a.key = key; a.dirty = true; }
        a.view = { s, robot: a.robot, task, board: feed.board, canvas: feed.canvas };
        if (a.dirty && onScreen(a.deskPos, 3)) drawMonitors(a, a.view);
      }
      for (const p of panels.values()) {
        if (p.id === 'clock') continue;
        p.dirty = true;
        if (onScreen(p.center, p.radius)) drawPanel(p);
      }
    },

    tickClock() {
      const p = panels.get('clock');
      if (onScreen(p.center, p.radius)) drawPanel(p);
    },

    update(t, dt) {
      // a cada ~1/4 s, o que mudou fora da tela e agora apareceu (a câmera andou) é redesenhado
      if (++frame % 15 === 0) {
        refreshFrustum();
        for (const a of actors.values()) if (a.dirty && a.view && onScreen(a.deskPos, 3)) drawMonitors(a, a.view);
        for (const p of panels.values()) if (p.dirty && onScreen(p.center, p.radius)) drawPanel(p);
      }
      for (const a of actors.values()) {
        let mode;
        if (a.path.length) {
          const p = a.path[0];
          const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
          const dist = Math.hypot(dx, dz);
          const step = SPEED * dt;
          if (dist <= step) {
            a.pos.x = p.x; a.pos.z = p.z; a.path.shift();
          } else {
            a.pos.x += (dx / dist) * step; a.pos.z += (dz / dist) * step;
            const want = Math.atan2(dx, dz);
            let diff = want - a.rot; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            a.rot += diff * Math.min(1, dt * 12);
          }
          a.seated = false;
          mode = 'walking';
        } else {
          const t0 = targetOf(a);
          let diff = t0.rot - a.rot; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          a.rot += diff * Math.min(1, dt * 8);
          a.seated = true;
          mode = a.status === 'working' ? 'working' : 'resting';
        }
        a.bot.root.position.copy(a.pos);
        a.bot.root.rotation.y = a.rot;
        a.bot.update(t, mode, a.seated ? 1 : 0);
      }
    },
  };

  return world;
}
