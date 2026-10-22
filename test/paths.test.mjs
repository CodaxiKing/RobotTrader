// Caminho dos robôs: ninguém atravessa mesas nem a divisória entre as alas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPath } from '../src/paths.js';

const layout = { aisles: [-10, 15], sideX: -30 };

test('na mesma ala: corredor, anda pelo corredor e entra no lugar', () => {
  const pts = planPath({ x: 5, z: -14, band: 0 }, { x: 12, z: -6, band: 0 }, layout);
  assert.deepEqual(pts.map(({ x, z }) => [x, z]), [[5, -10], [12, -10], [12, -6]]);
});

test('para a sala de reunião na outra ala: passa pelo corredor junto à parede esquerda', () => {
  const pts = planPath({ x: 5, z: -14, band: 0 }, { x: 20, z: 11, band: 1 }, layout);
  assert.deepEqual(pts.map(({ x, z }) => [x, z]), [[5, -10], [-30, -10], [-30, 15], [20, 15], [20, 11]]);
  // entre as alas só anda em x = sideX
  for (let i = 1; i < pts.length; i++) {
    const crosses = Math.sign(pts[i - 1].z - 2.5) !== Math.sign(pts[i].z - 2.5);
    if (crosses) assert.equal(pts[i].x, layout.sideX, 'cruzou a divisória fora do corredor');
  }
});

test('já no corredor e alinhado: vai direto para o lugar', () => {
  const pts = planPath({ x: 12, z: -10, band: 0 }, { x: 12, z: -6, band: 0 }, layout);
  assert.deepEqual(pts.map(({ x, z }) => [x, z]), [[12, -6]]);
});
