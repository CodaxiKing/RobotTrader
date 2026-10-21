// ─────────────────────────────────────────────────────────────
// Configuração do escritório: andares e robôs.
// Para adicionar um robô, acrescente uma entrada em ROBOTS (ou aumente o `count`
// de um andar). O layout das mesas e do descanso é calculado automaticamente.
// ─────────────────────────────────────────────────────────────

export const OFFICE = {
  title: 'RobotTrader',
  subtitle: 'Escritório virtual dos seus robôs',
  currency: 'US$',
};

export const FLOORS = [
  { id: 'mt5', label: '01', name: 'Operações MT5', sub: 'Seu escritório', level: 0, count: 12, prefix: 'PA', symbols: ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'] },
  { id: 'nt', label: '02', name: 'NinjaTrader', sub: 'Futures', level: 1, count: 8, prefix: 'NT', symbols: ['NQ', 'ES', 'YM', 'CL', 'GC'] },
];

export const SETUPS = ['SETUP 1.0', 'SETUP 1.4', 'SETUP 2.1', 'SETUP 3.1', 'SETUP 3.3', 'SETUP 3.5', 'SINAL GERAL', 'ROMPIMENTO', 'PULLBACK'];

const PALETTE = [
  '#38bdf8', '#a3e635', '#f472b6', '#fb923c', '#c084fc', '#2dd4bf',
  '#facc15', '#f87171', '#60a5fa', '#4ade80', '#e879f9', '#fbbf24',
];

export const ROBOTS = FLOORS.flatMap((f) =>
  Array.from({ length: f.count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `${f.prefix}_${n}`,
      name: `${f.prefix}_${n}`,
      floor: f.id,
      slot: i,
      color: PALETTE[(i + (f.level ? 3 : 0)) % PALETTE.length],
      symbols: f.symbols,
    };
  })
);

export const robotById = (id) => ROBOTS.find((r) => r.id === id);
