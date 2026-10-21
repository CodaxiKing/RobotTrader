// Cena: andares voxel com paredes neon amarelas, mesas com dois monitores, robôs e sala de descanso.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { M, glow, box, canvasTex, screenPlane, blobShadow, YELLOW } from './common.js';
import { makeBot } from './robot.js';
import {
  fmt, pnlOf, pnlColor, drawMonitorChart, drawMonitorInfo, drawWallTotal, drawWallClock, drawWallChart, drawLogo, drawRug,
} from './screens.js';
import { OFFICE } from './data/robots.js';

export const FX = 15;   // meia largura do andar (x)
export const FZ = 9;    // meia profundidade (z)
export const FH = 26;   // distância vertical entre andares
const AISLE_Z = 3.6;    // corredor por onde os robôs andam entre mesas e descanso
const SPEED = 5.5;

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d4b'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#454959'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64); g.strokeRect(64, 0, 64, 64); g.strokeRect(0, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(FX, FZ);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function deskLayout(floor, count, slot) {
  const cols = Math.ceil(count / 2);
  const row = Math.floor(slot / cols), col = slot % cols;
  const step = 4.8;
  return { x: (col - (cols - 1) / 2) * step, z: row === 0 ? -5.2 : 0.2 };
}

function sofaLayout(count, slot) {
  const sofas = Math.ceil(count / 2);
  const step = 4.8;
  const sx = (Math.floor(slot / 2) - (sofas - 1) / 2) * step;
  return { sofaX: sx, x: sx + (slot % 2 ? 0.85 : -0.85), z: 6.5 };
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false });

export function buildWorld(scene, floors, robots, { getState, getMode }) {
  const floorMap = new Map();
  const actors = new Map();
  const hits = [];
  const wall = [];  // painéis das paredes por andar

  const makeScreen = (parent, w, h, cw, ch, x, y, z, rotY, framed = true) => {
    const ct = canvasTex(cw, ch);
    if (framed) {
      const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = rotY; parent.add(f);
      box(f, w + 0.3, h + 0.3, 0.12, glow(YELLOW, 1.5), 0, 0, -0.1, { cast: false });
    }
    screenPlane(parent, w, h, ct, x, y, z, rotY);
    return ct;
  };

  for (const fl of floors) {
    const g = new THREE.Group();
    g.position.y = fl.level * FH;
    scene.add(g);
    const mine = robots.filter((r) => r.floor === fl.id);
    const F = { cfg: fl, group: g, robots: mine, balloons: [] };
    floorMap.set(fl.id, F);

    // piso + laje
    box(g, FX * 2 + 0.6, 0.9, FZ * 2 + 0.6, M(0x12131a), 0, -0.45, 0, { cast: false });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(FX * 2, FZ * 2), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.01; top.receiveShadow = true; g.add(top);
    box(g, FX * 2 + 0.6, 0.2, 0.24, glow(YELLOW), 0, 0.02, FZ + 0.3, { cast: false });
    box(g, 0.24, 0.2, FZ * 2 + 0.6, glow(YELLOW), FX + 0.3, 0.02, 0, { cast: false });

    // paredes (fundo e esquerda), ripadas, com friso neon no topo
    const wallM = M(0x353846), slatM = M(0x272a37);
    box(g, FX * 2 + 0.6, 5.6, 0.5, wallM, 0, 2.8, -FZ - 0.25, { cast: false });
    box(g, 0.5, 5.6, FZ * 2 + 0.6, wallM, -FX - 0.25, 2.8, 0, { cast: false });
    for (let x = -FX + 0.75; x < FX; x += 1.5) box(g, 0.5, 4.8, 0.14, slatM, x, 2.55, -FZ + 0.07, { cast: false });
    for (let z = -FZ + 0.75; z < FZ; z += 1.5) box(g, 0.14, 4.8, 0.5, slatM, -FX + 0.07, 2.55, z, { cast: false });
    box(g, FX * 2 + 0.6, 0.18, 0.34, glow(YELLOW), 0, 5.62, -FZ - 0.25, { cast: false });
    box(g, 0.34, 0.18, FZ * 2 + 0.6, glow(YELLOW), -FX - 0.25, 5.62, 0, { cast: false });
    box(g, 0.34, 5.6, 0.34, glow(YELLOW), -FX - 0.25, 2.8, -FZ - 0.25, { cast: false });
    box(g, FX * 2 + 0.6, 0.14, 0.3, glow(YELLOW, 1.2), 0, 0.3, -FZ - 0.2, { cast: false });
    box(g, 0.3, 0.14, FZ * 2 + 0.6, glow(YELLOW, 1.2), -FX - 0.2, 0.3, 0, { cast: false });

    // logo + painéis de parede
    const logo = canvasTex(256, 256);
    drawLogo(logo.ctx, 256, 256, OFFICE.title.slice(0, 2).toUpperCase());
    logo.tex.needsUpdate = true;
    screenPlane(g, 3.8, 3.8, logo, 0, 3.0, -FZ + 0.25, 0, true);
    F.wallTotal = makeScreen(g, 8.6, 3.1, 640, 232, -8.6, 3.0, -FZ + 0.3, 0);
    F.wallClock = makeScreen(g, 8.6, 3.1, 640, 232, 8.6, 3.0, -FZ + 0.3, 0);
    F.wallChart = makeScreen(g, 9.6, 3.4, 720, 255, -FX + 0.3, 3.0, 0, Math.PI / 2);
    wall.push(F);

    // sala de descanso
    const rug = canvasTex(1120, 150);
    drawRug(rug.ctx, 1120, 150, 'EM DESCANSO');
    rug.tex.needsUpdate = true;
    const rugMesh = new THREE.Mesh(new THREE.PlaneGeometry(28.4, 3.8), new THREE.MeshBasicMaterial({ map: rug.tex, transparent: true, toneMapped: false }));
    rugMesh.rotation.x = -Math.PI / 2; rugMesh.position.set(0, 0.04, 6.9); g.add(rugMesh);
    const sofas = Math.ceil(mine.length / 2);
    for (let i = 0; i < sofas; i++) {
      const sx = (i - (sofas - 1) / 2) * 4.8;
      const sm = M(0x3a3320), sb = M(0x2c2718);
      box(g, 3.5, 0.55, 1.3, sm, sx, 0.3, 6.5);
      box(g, 3.5, 1.1, 0.3, sb, sx, 0.85, 5.95);
      box(g, 0.3, 0.9, 1.3, sb, sx - 1.75, 0.55, 6.5);
      box(g, 0.3, 0.9, 1.3, sb, sx + 1.75, 0.55, 6.5);
      box(g, 3.1, 0.1, 0.1, glow(YELLOW, 1.2), sx, 0.12, 7.2, { cast: false });
      box(g, 0.7, 0.45, 0.7, M(0x2a2a33), sx + 2.65, 0.22, 7.3); // pufe
    }

    // luzes de ambiente por andar
    for (const [lx, lz] of [[-9, -2], [9, 2]]) {
      const pl = new THREE.PointLight(0xffb300, 16, 20, 1.8);
      pl.position.set(lx, 5, lz);
      g.add(pl);
    }

    // mesas + robôs
    for (const r of mine) {
      const d = deskLayout(fl, mine.length, r.slot);
      const sofa = sofaLayout(mine.length, r.slot);
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

      // balão com nome e saldo
      const el = document.createElement('div');
      el.className = 'bubble';
      el.dataset.robot = r.id;
      el.innerHTML = '<div class="b-top"><i class="b-dot"></i><b class="b-name"></b></div><div class="b-pnl"></div><div class="b-setup"></div>';
      const label = new CSS2DObject(el);
      label.position.set(0, r.slot % 2 ? 4.5 : 3.5, 0); // alterna a altura para os balões da fileira de descanso não se sobreporem
      bot.root.add(label);

      const actor = {
        id: r.id, robot: r, floor: fl, bot, screens, el, label,
        desk: { x: d.x, z: d.z + 1.25, rot: Math.PI },
        rest: { x: sofa.x, z: sofa.z, rot: 0 },
        pos: new THREE.Vector3(), path: [], rot: 0, seated: false, status: null,
        pnlEl: el.querySelector('.b-pnl'), setupEl: el.querySelector('.b-setup'), nameEl: el.querySelector('.b-name'), dotEl: el.querySelector('.b-dot'),
      };
      actor.nameEl.textContent = r.name;
      actors.set(r.id, actor);
      F.balloons.push(actor);

      // posição inicial sem animação
      const st0 = st?.status === 'operating' ? actor.desk : actor.rest;
      actor.pos.set(st0.x, 0, st0.z); actor.rot = st0.rot; actor.status = st?.status || 'rest';
      bot.root.position.copy(actor.pos); bot.root.rotation.y = actor.rot;
    }
  }

  function setActorStatus(a, status) {
    if (a.status === status) return;
    a.status = status;
    const target = status === 'operating' ? a.desk : a.rest;
    const pts = [];
    if (Math.abs(a.pos.z - AISLE_Z) > 0.05) pts.push({ x: a.pos.x, z: AISLE_Z });
    if (Math.abs(a.pos.x - target.x) > 0.05) pts.push({ x: target.x, z: AISLE_Z });
    pts.push({ x: target.x, z: target.z, final: true });
    a.path = pts;
  }

  const aggregate = (F) => {
    let op = 0, rest = 0, total = 0;
    const len = Math.max(...F.robots.map((r) => getState(r.id).equity.length), 0);
    const series = Array.from({ length: len }, () => 0);
    for (const r of F.robots) {
      const s = getState(r.id);
      s.status === 'operating' ? op++ : rest++;
      total += pnlOf(s, getMode());
      s.equity.forEach((v, i) => (series[len - s.equity.length + i] += v));
    }
    return { op, rest, total, series };
  };

  let currentFloor = null;
  const world = {
    floors: floorMap, actors, hits,
    floorY: (id) => floorMap.get(id).cfg.level * FH,
    get current() { return currentFloor; },

    setFloor(id) {
      currentFloor = id;
      for (const F of floorMap.values()) {
        const vis = !id || F.cfg.id === id;
        F.group.visible = vis;
        F.balloons.forEach((a) => (a.label.visible = vis));
      }
    },

    // aplica o estado atual do feed nas telas, balões e destino de cada robô
    sync() {
      const mode = getMode();
      for (const a of actors.values()) {
        const s = getState(a.id);
        setActorStatus(a, s.status);
        const v = pnlOf(s, mode);
        a.pnlEl.textContent = fmt(v);
        a.pnlEl.style.color = pnlColor(v);
        a.setupEl.textContent = s.status === 'operating' ? s.setup : '';
        a.setupEl.style.display = s.status === 'operating' ? '' : 'none';
        a.el.classList.toggle('rest', s.status !== 'operating');
        a.dotEl.style.background = s.status === 'operating' ? '#4ade80' : '#6b7090';
        const [c1, c2] = a.screens;
        drawMonitorChart(c1.ctx, c1.w, c1.h, s, a.robot); c1.tex.needsUpdate = true;
        drawMonitorInfo(c2.ctx, c2.w, c2.h, s, a.robot, mode); c2.tex.needsUpdate = true;
      }
      for (const F of wall) {
        const ag = aggregate(F);
        const { ctx, w, h, tex } = F.wallTotal;
        drawWallTotal(ctx, w, h, { title: `${F.cfg.name.toUpperCase()} · RESULTADO`, value: ag.total, operating: ag.op, resting: ag.rest }); tex.needsUpdate = true;
        const cc = F.wallChart;
        drawWallChart(cc.ctx, cc.w, cc.h, ag.series, `CURVA DO ANDAR · ${F.cfg.sub.toUpperCase()}`); cc.tex.needsUpdate = true;
      }
    },

    tickClock(date) {
      for (const F of wall) {
        const { ctx, w, h, tex } = F.wallClock;
        drawWallClock(ctx, w, h, date, F.cfg.name.toUpperCase()); tex.needsUpdate = true;
      }
    },

    update(t, dt) {
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
          const t0 = a.status === 'operating' ? a.desk : a.rest;
          let diff = t0.rot - a.rot; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          a.rot += diff * Math.min(1, dt * 8);
          a.seated = true;
          mode = a.status === 'operating' ? 'working' : 'resting';
        }
        a.bot.root.position.copy(a.pos);
        a.bot.root.rotation.y = a.rot;
        a.bot.update(t, mode, a.seated ? 1 : 0);
      }
    },
  };

  return world;
}
