// Robô voxel: tudo feito de caixas. Anda, senta digitando (operando) ou senta relaxado (descanso).
import * as THREE from 'three';
import { M, glow, box } from './common.js';

const lerp = THREE.MathUtils.lerp;

export function makeBot(color) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const white = M(0xe9ecf5, { roughness: 0.6 });
  const dark = M(0x161824, { roughness: 0.45 });
  const acc = M(color, { roughness: 0.55 });
  const eyeM = glow(color, 2.4);

  const legs = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Group();
    p.position.set(sx * 0.22, 0.55, 0);
    box(p, 0.3, 0.55, 0.32, dark, 0, -0.275, 0);
    box(p, 0.34, 0.14, 0.44, acc, 0, -0.48, 0.06);
    rig.add(p);
    legs.push(p);
  }

  const body = new THREE.Group();
  body.position.y = 0.55;
  rig.add(body);
  box(body, 0.88, 0.74, 0.54, acc, 0, 0.37, 0);
  box(body, 0.5, 0.3, 0.06, dark, 0, 0.42, 0.28);
  box(body, 0.14, 0.14, 0.07, eyeM, 0, 0.42, 0.31, { cast: false });
  box(body, 0.9, 0.08, 0.56, white, 0, 0.03, 0);

  const arms = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Group();
    p.position.set(sx * 0.58, 0.64, 0);
    box(p, 0.22, 0.6, 0.24, acc, 0, -0.27, 0);
    box(p, 0.25, 0.2, 0.27, white, 0, -0.62, 0);
    body.add(p);
    arms.push(p);
  }

  const head = new THREE.Group();
  head.position.y = 1.12;
  body.add(head);
  box(head, 0.98, 0.76, 0.76, white, 0, 0, 0);
  box(head, 0.8, 0.42, 0.1, dark, 0, 0.02, 0.38, { cast: false });
  const eyes = [];
  for (const sx of [-1, 1]) eyes.push(box(head, 0.17, 0.17, 0.06, eyeM, sx * 0.2, 0.03, 0.44, { cast: false }));
  for (const sx of [-1, 1]) box(head, 0.12, 0.3, 0.3, acc, sx * 0.55, 0, 0);
  box(head, 0.06, 0.3, 0.06, dark, 0, 0.53, 0);
  const tip = box(head, 0.15, 0.15, 0.15, eyeM, 0, 0.74, 0, { cast: false });

  let sit = 0;
  const phase = Math.random() * 10;
  let blinkAt = 2 + Math.random() * 4;

  // mode: 'walking' | 'working' | 'resting'
  function update(t, mode, sitTarget) {
    sit = lerp(sit, sitTarget, 0.14);
    const legRot = -sit * 1.45;
    if (mode === 'walking') {
      const s = Math.sin(t * 9 + phase);
      legs[0].rotation.x = s * 0.55; legs[1].rotation.x = -s * 0.55;
      arms[0].rotation.x = -s * 0.5; arms[1].rotation.x = s * 0.5;
      body.position.y = 0.55 + Math.abs(Math.cos(t * 9 + phase)) * 0.06;
      head.rotation.set(0, 0, 0);
    } else {
      legs[0].rotation.x = legRot; legs[1].rotation.x = legRot;
      body.position.y = 0.55 + Math.sin(t * 2 + phase) * 0.012;
      if (mode === 'working') {
        arms[0].rotation.x = -1.15 + Math.sin(t * 15 + phase) * 0.12;
        arms[1].rotation.x = -1.15 + Math.sin(t * 15 + phase + Math.PI) * 0.12;
        head.rotation.y = lerp(head.rotation.y, Math.sin(t * 0.8 + phase) * 0.18, 0.08);
        head.rotation.x = lerp(head.rotation.x, 0.12, 0.08);
        eyeM.emissiveIntensity = 2.4 + Math.sin(t * 6) * 0.5;
      } else {
        arms[0].rotation.x = lerp(arms[0].rotation.x, -0.25, 0.1);
        arms[1].rotation.x = lerp(arms[1].rotation.x, -0.25 + Math.sin(t * 1.4 + phase) * 0.06, 0.1);
        head.rotation.y = lerp(head.rotation.y, Math.sin(t * 0.5 + phase) * 0.5, 0.05);
        head.rotation.x = lerp(head.rotation.x, 0.05, 0.05);
      }
    }
    rig.position.y = sit * 0.08;
    const blinking = t > blinkAt && t < blinkAt + 0.12;
    eyes.forEach((e) => (e.scale.y = blinking ? 0.03 : 0.17));
    if (t > blinkAt + 0.12) blinkAt = t + 2.5 + Math.random() * 4;
    tip.scale.setScalar(0.15 * (1 + Math.sin(t * 4 + phase) * 0.18));
  }

  return { root, rig, head, update };
}
