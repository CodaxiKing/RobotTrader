// Mapa pequeno: o salão visto de cima, com as zonas, a sala de reunião e um ponto por robô
// (verde trabalhando, ciano em reunião, cinza livre). Clicar numa zona leva a câmera até ela.
const DOT = { working: '#4ade80', meeting: '#22d3ee', idle: '#6b7090' };

export function createMinimap(canvas, { plan, actors, getState, onPick }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 220, cssH = canvas.clientHeight || 150;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const pad = 6;
  const k = Math.min((cssW - pad * 2) / (plan.FX * 2), (cssH - pad * 2) / (plan.FZ * 2));
  const ox = (cssW - plan.FX * 2 * k) / 2, oz = (cssH - plan.FZ * 2 * k) / 2;
  const px = (x) => ox + (x + plan.FX) * k;
  const pz = (z) => oz + (z + plan.FZ) * k;
  const rectOf = (r) => [px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * k, r.d * k];

  function draw(current, light = false) {
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = light ? 'rgba(220,224,234,0.95)' : 'rgba(10,12,22,0.92)';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = 'rgba(255,196,0,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(px(-plan.FX), pz(-plan.FZ), plan.FX * 2 * k, plan.FZ * 2 * k);
    ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textBaseline = 'top';
    for (const z of plan.zones) {
      const [x, y, w, h] = rectOf(z);
      const on = z.id === current;
      ctx.fillStyle = on ? 'rgba(255,196,0,0.22)' : light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      ctx.strokeStyle = on ? '#ffc400' : 'rgba(255,196,0,0.25)';
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.fillStyle = on ? '#ffc400' : light ? '#5b6178' : '#8f94b3';
      ctx.fillText(z.label, x + 3, y + 3);
    }
    const [mx, my, mw, mh] = rectOf(plan.meet);
    ctx.setLineDash([3, 2]); ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.strokeRect(mx + 1, my + 1, mw - 2, mh - 2); ctx.setLineDash([]);
    ctx.fillStyle = '#22d3ee'; ctx.fillText('R', mx + 3, my + 3);
    for (const a of actors.values()) {
      const s = getState(a.id);
      ctx.fillStyle = s.paused ? '#ffc400' : DOT[s.status] || DOT.idle;
      ctx.beginPath(); ctx.arc(px(a.pos.x), pz(a.pos.z), 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - ox) / k - plan.FX;
    const z = (e.clientY - r.top - oz) / k - plan.FZ;
    const inside = (b) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2;
    const zone = plan.zones.find(inside);
    onPick(zone ? zone.id : null);
  });

  return { draw };
}
