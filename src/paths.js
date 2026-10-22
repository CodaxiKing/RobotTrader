// Caminho de um robô até o destino (mesa, sofá ou cadeira da sala de reunião), sem atravessar
// mesas nem a divisória entre as alas: vai até o corredor da sua ala, troca de ala pelo corredor
// junto à parede esquerda se precisar, anda pelo corredor da ala de destino e entra no lugar.
//   from:   { x, z, band }     posição atual e ala
//   target: { x, z, band }     destino e ala
//   layout: { aisles: [z da ala 0, z da ala 1…], sideX }
export function planPath(from, target, { aisles, sideX }) {
  const fromAisle = aisles[from.band];
  const toAisle = aisles[target.band];
  const pts = [];
  if (Math.abs(from.z - fromAisle) > 0.05) pts.push({ x: from.x, z: fromAisle });
  if (target.band !== from.band) pts.push({ x: sideX, z: fromAisle }, { x: sideX, z: toAisle });
  const lastX = pts.at(-1)?.x ?? from.x;
  if (Math.abs(lastX - target.x) > 0.05) pts.push({ x: target.x, z: toAisle });
  pts.push({ x: target.x, z: target.z, final: true });
  return pts;
}
