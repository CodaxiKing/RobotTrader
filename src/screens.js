// Desenho em canvas: monitores das mesas, painéis das paredes e a tela grande de cada robô.
const UP = '#34d399';
const DOWN = '#f87171';
const GOLD = '#ffc400';

export const fmt = (n, { sign = false } = {}) => {
  const v = Number.isFinite(n) ? n : 0;
  const body = `US$ ${Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v < 0) return `-${body}`;
  return sign && v > 0 ? `+${body}` : body;
};
export const fmtTime = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const fmtClock = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// P&L exibido conforme o filtro: 'closed' | 'open' | 'both'
export const pnlOf = (s, mode) => (mode === 'closed' ? s.closedPnl : mode === 'open' ? s.openPnl : s.closedPnl + s.openPnl);
export const pnlColor = (v) => (v < 0 ? DOWN : UP);

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function bg(ctx, w, h, color = '#070a12') {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
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
  if (min < 0 && max > 0) { ctx.strokeStyle = 'rgba(255,196,0,0.35)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, py(0)); ctx.lineTo(x + w, py(0)); ctx.stroke(); ctx.setLineDash([]); }
  const color = series[series.length - 1] >= series[0] ? UP : DOWN;
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

// Monitor esquerdo da mesa: curva de equity
export function drawMonitorChart(ctx, w, h, s, robot) {
  bg(ctx, w, h);
  ctx.fillStyle = robot.color; ctx.fillRect(0, 0, w, 6);
  ctx.fillStyle = '#c7cbe0'; ctx.font = `bold ${h * 0.11}px system-ui, sans-serif`; ctx.textBaseline = 'top';
  ctx.fillText(`${robot.name} · ${s.symbol}`, w * 0.04, h * 0.1);
  if (s.status === 'rest') {
    ctx.fillStyle = '#6b7090'; ctx.font = `bold ${h * 0.14}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('EM DESCANSO', w / 2, h * 0.5); ctx.textAlign = 'left';
    return;
  }
  chart(ctx, w * 0.04, h * 0.28, w * 0.92, h * 0.62, s.equity);
}

// Monitor direito da mesa: P&L e operação atual
export function drawMonitorInfo(ctx, w, h, s, robot, mode) {
  bg(ctx, w, h, '#080c16');
  const v = pnlOf(s, mode);
  ctx.textBaseline = 'top';
  ctx.fillStyle = s.status === 'operating' ? UP : '#8087a8'; ctx.font = `bold ${h * 0.1}px system-ui, sans-serif`;
  ctx.fillText(s.status === 'operating' ? '● OPERANDO' : '○ DESCANSO', w * 0.05, h * 0.08);
  ctx.fillStyle = pnlColor(v); ctx.font = `bold ${h * 0.2}px system-ui, sans-serif`;
  ctx.fillText(fmt(v), w * 0.05, h * 0.26);
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.1}px system-ui, sans-serif`;
  ctx.fillText(s.setup, w * 0.05, h * 0.55);
  ctx.fillStyle = s.side === 'BUY' ? UP : DOWN; ctx.font = `${h * 0.095}px system-ui, sans-serif`;
  ctx.fillText(`${s.symbol} ${s.side}`, w * 0.05, h * 0.72);
}

// Tela grande (overlay "abrir tela" e miniaturas): gráfico + resumo + operações
export function drawFullScreen(ctx, w, h, s, robot, mode) {
  bg(ctx, w, h);
  const u = h / 540;
  ctx.fillStyle = robot.color; ctx.fillRect(0, 0, w, 8 * u);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e6e8f5'; ctx.font = `bold ${30 * u}px system-ui, sans-serif`;
  ctx.fillText(robot.name, 24 * u, 26 * u);
  ctx.fillStyle = s.status === 'operating' ? UP : '#8087a8'; ctx.font = `bold ${18 * u}px system-ui, sans-serif`;
  ctx.fillText(s.status === 'operating' ? '● OPERANDO' : '○ EM DESCANSO', 24 * u, 66 * u);
  const v = pnlOf(s, mode);
  ctx.textAlign = 'right'; ctx.fillStyle = pnlColor(v); ctx.font = `bold ${44 * u}px system-ui, sans-serif`;
  ctx.fillText(fmt(v), w - 24 * u, 22 * u);
  ctx.fillStyle = GOLD; ctx.font = `bold ${18 * u}px system-ui, sans-serif`;
  ctx.fillText(`${s.setup} · ${s.symbol} ${s.side}`, w - 24 * u, 76 * u);
  ctx.textAlign = 'left';
  chart(ctx, 24 * u, 110 * u, w * 0.58, h - 150 * u, s.equity);
  // coluna direita: números + últimas operações
  const x0 = w * 0.58 + 52 * u;
  ctx.font = `${17 * u}px system-ui, sans-serif`;
  const rows = [['Aberto', fmt(s.openPnl, { sign: true }), pnlColor(s.openPnl)], ['Fechado', fmt(s.closedPnl, { sign: true }), pnlColor(s.closedPnl)], ['Saldo', fmt(s.balance), '#c7cbe0']];
  rows.forEach(([k, val, c], i) => {
    const yy = 118 * u + i * 30 * u;
    ctx.fillStyle = '#8087a8'; ctx.textAlign = 'left'; ctx.fillText(k, x0, yy);
    ctx.fillStyle = c; ctx.textAlign = 'right'; ctx.fillText(val, w - 24 * u, yy);
  });
  ctx.textAlign = 'left'; ctx.fillStyle = GOLD; ctx.font = `bold ${14 * u}px system-ui, sans-serif`;
  ctx.fillText('ÚLTIMAS OPERAÇÕES', x0, 222 * u);
  ctx.font = `${15 * u}px system-ui, sans-serif`;
  s.trades.slice(-7).reverse().forEach((t, i) => {
    const yy = 250 * u + i * 27 * u;
    ctx.fillStyle = '#8087a8'; ctx.textAlign = 'left'; ctx.fillText(`${fmtTime(t.ts)}  ${t.symbol} ${t.side}`, x0, yy);
    ctx.fillStyle = pnlColor(t.pnl); ctx.textAlign = 'right'; ctx.fillText(fmt(t.pnl, { sign: true }), w - 24 * u, yy);
  });
  ctx.textAlign = 'left';
}

// ── painéis das paredes ──
export function drawWallTotal(ctx, w, h, { title, value, operating, resting }) {
  bg(ctx, w, h, '#0a0d16');
  ctx.textBaseline = 'top';
  ctx.fillStyle = GOLD; ctx.font = `bold ${h * 0.11}px system-ui, sans-serif`;
  ctx.fillText(title, w * 0.05, h * 0.1);
  ctx.fillStyle = pnlColor(value); ctx.font = `bold ${h * 0.34}px system-ui, sans-serif`;
  ctx.fillText(fmt(value), w * 0.05, h * 0.3);
  ctx.fillStyle = '#9aa0c0'; ctx.font = `${h * 0.12}px system-ui, sans-serif`;
  ctx.fillText(`${operating} em operação · ${resting} em descanso`, w * 0.05, h * 0.78);
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

export function drawLogo(ctx, w, h, text) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = w * 0.42;
  const hex = (rad) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } ctx.closePath(); };
  hex(r); ctx.fillStyle = '#0d0f17'; ctx.fill();
  hex(r); ctx.strokeStyle = GOLD; ctx.lineWidth = w * 0.035; ctx.stroke();
  hex(r * 0.78); ctx.strokeStyle = 'rgba(255,196,0,0.45)'; ctx.lineWidth = w * 0.012; ctx.stroke();
  ctx.fillStyle = GOLD; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${w * 0.22}px system-ui, sans-serif`; ctx.fillText(text, cx, cy - h * 0.02);
  ctx.font = `bold ${w * 0.065}px system-ui, sans-serif`; ctx.fillText('ROBOT OFFICE', cx, cy + h * 0.17);
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
