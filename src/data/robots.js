// ─────────────────────────────────────────────────────────────
// Configuração do escritório: zonas (times), papéis e robôs.
// Para adicionar um robô, acrescente uma entrada em TEAM. O layout das mesas, do
// descanso e o tamanho do salão são calculados a partir da ordem dentro da zona.
// ─────────────────────────────────────────────────────────────

export const OFFICE = {
  title: 'PetLive',
  subtitle: 'Escritório de robôs do SaaS',
  logo: 'PL',
  // os robôs só fazem merge aqui; produção (main) só com release aprovado pelo dono
  baseBranch: 'develop',
  productionBranch: 'main',
  // gasto máximo por dia com os agentes; ao bater, o escritório pausa sozinho
  dailyBudgetUsd: 20,
};

export const FLOORS = [
  { id: 'po', label: '01', name: 'Produto', sub: 'P.O · board · canvas', level: 0 },
  { id: 'dev', label: '02', name: 'Desenvolvimento', sub: 'Next.js · React Native', level: 1 },
  { id: 'sec', label: '03', name: 'Segurança', sub: 'Revisão de código · OWASP', level: 2 },
  { id: 'qa', label: '04', name: 'Qualidade', sub: 'QA · testes e relatório', level: 3 },
  { id: 'ops', label: '05', name: 'Operações', sub: 'Release · erros · docs · dados', level: 4 },
  { id: 'lab', label: '06', name: 'Melhorias', sub: 'Código · design · UX · a11y', level: 5 },
  { id: 'mkt', label: '07', name: 'Marketing', sub: 'Agência · criativos e vídeo', level: 6 },
];

// kind decide o comportamento: po distribui, canvas mantém o canvas de design em dia com o
// código, dev implementa, sec revisa a segurança, qa testa, ops cuida de produção e do release,
// docs escreve changelog e notas de versão, data analisa o uso, idea sugere melhorias. Os kinds da
// agência (mktlead, script, copy, art, video, critic, social) estão em data/marketing.js.
// area separa web (Next.js) de app (React Native); focus é o tipo de sugestão.
export const ROLES = {
  po: { label: 'Product Owner', short: 'P.O', kind: 'po' },
  canvas: { label: 'Canvas · telas e design', short: 'Canvas', kind: 'canvas' },
  web: { label: 'Dev Web · Next.js', short: 'Next.js', kind: 'dev', area: 'web' },
  app: { label: 'Dev App · React Native', short: 'React Native', kind: 'dev', area: 'app' },
  sec: { label: 'Segurança · AppSec', short: 'AppSec', kind: 'sec' },
  qaWeb: { label: 'QA Web · Playwright', short: 'QA Web', kind: 'qa', area: 'web' },
  qaApp: { label: 'QA App · Maestro', short: 'QA App', kind: 'qa', area: 'app' },
  ops: { label: 'Operações · release e erros', short: 'Ops', kind: 'ops' },
  docs: { label: 'Documentação · changelog', short: 'Docs', kind: 'docs' },
  data: { label: 'Dados · analytics', short: 'Dados', kind: 'data' },
  code: { label: 'Melhorias · código', short: 'Código', kind: 'idea', focus: 'dev' },
  perf: { label: 'Melhorias · performance', short: 'Performance', kind: 'idea', focus: 'dev' },
  design: { label: 'Melhorias · design', short: 'Design', kind: 'idea', focus: 'design' },
  ux: { label: 'Melhorias · UX e produto', short: 'UX', kind: 'idea', focus: 'ux' },
  a11y: { label: 'Melhorias · acessibilidade', short: 'A11y', kind: 'idea', focus: 'a11y' },
  mktlead: { label: 'Marketing · estratégia e divulgação', short: 'Estratégia', kind: 'mktlead' },
  script: { label: 'Marketing · roteiro de vídeo', short: 'Roteiro', kind: 'script' },
  copy: { label: 'Marketing · legendas e textos', short: 'Copy', kind: 'copy' },
  art: { label: 'Marketing · criativos', short: 'Design', kind: 'art' },
  video: { label: 'Marketing · edição de vídeo', short: 'Vídeo', kind: 'video' },
  critic: { label: 'Marketing · avaliação de criativos', short: 'Avaliação', kind: 'critic' },
  social: { label: 'Marketing · social media', short: 'Social', kind: 'social' },
};

const TEAM = [
  { id: 'PO_01', floor: 'po', role: 'po' },
  { id: 'CANVAS_01', floor: 'po', role: 'canvas', color: '#22d3ee' },
  { id: 'WEB_01', floor: 'dev', role: 'web' },
  { id: 'WEB_02', floor: 'dev', role: 'web' },
  { id: 'WEB_03', floor: 'dev', role: 'web' },
  { id: 'APP_01', floor: 'dev', role: 'app' },
  { id: 'APP_02', floor: 'dev', role: 'app' },
  { id: 'APP_03', floor: 'dev', role: 'app' },
  { id: 'SEC_01', floor: 'sec', role: 'sec', color: '#ef4444' },
  { id: 'QA_01', floor: 'qa', role: 'qaWeb' },
  { id: 'QA_02', floor: 'qa', role: 'qaWeb' },
  { id: 'QA_03', floor: 'qa', role: 'qaApp' },
  { id: 'QA_04', floor: 'qa', role: 'qaApp' },
  { id: 'OPS_01', floor: 'ops', role: 'ops', color: '#34d399' },
  { id: 'DOCS_01', floor: 'ops', role: 'docs', color: '#e2e8f0' },
  { id: 'DATA_01', floor: 'ops', role: 'data', color: '#fbbf24' },
  { id: 'CODE_01', floor: 'lab', role: 'code' },
  { id: 'PERF_01', floor: 'lab', role: 'perf' },
  { id: 'DESIGN_01', floor: 'lab', role: 'design' },
  { id: 'UX_01', floor: 'lab', role: 'ux' },
  { id: 'A11Y_01', floor: 'lab', role: 'a11y', color: '#a78bfa' },
  { id: 'MKT_LEAD', floor: 'mkt', role: 'mktlead', color: '#fb7185' },
  { id: 'ROTEIRO_01', floor: 'mkt', role: 'script', color: '#fda4af' },
  { id: 'COPY_01', floor: 'mkt', role: 'copy', color: '#fde68a' },
  { id: 'ARTE_01', floor: 'mkt', role: 'art', color: '#f0abfc' },
  { id: 'VIDEO_01', floor: 'mkt', role: 'video', color: '#f472b6' },
  { id: 'REVISOR_01', floor: 'mkt', role: 'critic', color: '#fdba74' },
  { id: 'SOCIAL_01', floor: 'mkt', role: 'social', color: '#67e8f9' },
];

const PALETTE = [
  '#38bdf8', '#a3e635', '#f472b6', '#fb923c', '#c084fc', '#2dd4bf',
  '#facc15', '#f87171', '#60a5fa', '#4ade80', '#e879f9', '#fbbf24',
];

export const ROBOTS = TEAM.map((t, i) => ({
  ...ROLES[t.role],
  id: t.id,
  name: t.id,
  floor: t.floor,
  role: t.role,
  roleLabel: ROLES[t.role].label,
  slot: TEAM.filter((x) => x.floor === t.floor).indexOf(t),
  color: t.color || PALETTE[i % PALETTE.length],
}));

export const robotById = (id) => ROBOTS.find((r) => r.id === id);

// Colunas do board, na ordem do fluxo
export const COLUMNS = [
  { id: 'todo', label: 'Backlog' },
  { id: 'refining', label: 'P.O refinando' },
  { id: 'dev', label: 'Em desenvolvimento' },
  { id: 'security', label: 'Segurança' },
  { id: 'qa', label: 'Em QA' },
  { id: 'rework', label: 'Correção' },
  { id: 'merged', label: 'Entregue' },
];
