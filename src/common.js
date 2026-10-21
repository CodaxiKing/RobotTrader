import * as THREE from 'three';

export const YELLOW = 0xffc400;

const unit = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();

// material "fosco" de cor chapada (visual voxel)
export function M(color, o = {}) {
  const key = `${color}|${JSON.stringify(o)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, ...o }));
  return matCache.get(key);
}

// material que brilha (neon); com o bloom do compositor vira halo
export const glow = (color, k = 1.8) => M(color, { emissive: color, emissiveIntensity: k, roughness: 0.4 });

// caixa escalada a partir de uma geometria unitária compartilhada
export function box(parent, w, h, d, material, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(unit, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

export function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas: c, ctx: c.getContext('2d'), tex, w, h };
}

// plano com textura de canvas (não afetado pela luz nem pelo tone mapping)
export function screenPlane(parent, w, h, ct, x, y, z, rotY = 0, transparent = false) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: ct.tex, toneMapped: false, transparent }));
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  parent.add(m);
  return m;
}

let blobTex = null;
export function blobShadow(parent, w, d, opacity = 0.4, x = 0, z = 0) {
  if (!blobTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  parent.add(m);
  return m;
}
