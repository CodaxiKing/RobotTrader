// ─────────────────────────────────────────────────────────────
// Fonte de dados simulada. A interface é a mesma do feed ao vivo (live.js):
//   feed.getState(id) -> estado do robô
//   feed.board        -> tasks do board, cada uma numa coluna (COLUMNS), na ordem de prioridade
//   feed.reports      -> relatórios do QA das tasks entregues (o mais novo por último)
//   feed.ideas        -> o que espera a decisão do dono (a mais nova por último): sugestões de
//                        melhoria, telas do canvas e releases para produção. Ficam 'aguardando'
//                        até approveIdea(id) / rejectIdea(id). canDecide diz se a fonte aceita decisão.
//   feed.delivered    -> entregas acumuladas, uma amostra por atualização (gráfico)
//   feed.canvas       -> o canvas de design: { title, url, version, syncedAt, screens, changes }
//   feed.releases     -> versões que foram para produção, com as notas do DOCS_01
//   feed.changelog    -> uma linha por entrega, escrita pelo DOCS_01
//   feed.incidents    -> erros de produção que o OPS_01 viu
//   feed.insights     -> o que o DATA_01 leu do uso das telas
//   feed.alerts       -> avisos para o dono (notificações), o mais novo por último
//   feed.audit        -> histórico completo: cada evento e cada decisão, com quem fez
//   feed.history      -> eventos recentes (o mais novo por último)
//   feed.spend        -> { today, day, series } em US$; feed.paused / pauseReason
//   feed.meeting      -> reunião em andamento: { taskId, robots, until } ou null
//   feed.marketing    -> a agência (marketing.js): { pieces, promotions }
//   ações: approveIdea, rejectIdea, setPaused(bool), setRobotPaused(id, bool), setBudget(usd),
//          prioritize(taskId, beforeId), ask(robotId, texto) -> Promise<resposta>,
//          adjustIdea(id, comentário) (post da agência volta para ajuste)
//   feed.subscribe(fn), feed.start(), feed.stop(), feed.updatedAt
//
// Estado de um robô:
//   { status: 'working' | 'idle' | 'meeting', activity, taskId, progress (0..1), done, commits, cost, paused }
//
// O fluxo: P.O tira a task do backlog e passa para um dev livre da área → o dev faz commits e
// push na branch → a Segurança revisa: achou falha, devolve para o dev; sem falha, segue → o QA
// testa: aprova (merge em develop + relatório) ou devolve. Task que volta duas vezes leva P.O,
// dev e revisor para a sala de reunião. O OPS_01 junta as entregas num release, que só vai para
// produção (main) com a aprovação do dono. Sugestões e telas novas também esperam o dono.
//
// Cada task guarda a linha do tempo (task.timeline) e o custo (task.cost). O custo da simulação é
// uma estimativa por rodada de trabalho; no motor real vem do total_cost_usd de cada agente.
// ─────────────────────────────────────────────────────────────
import { ROBOTS, OFFICE, robotById } from './robots.js';
import CANVAS from './canvas.json' with { type: 'json' };
import { createMarketing } from './marketing.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const sha = () => Math.random().toString(16).slice(2, 9);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

// Telas do canvas de design (src/data/canvas.json, gerado por scripts/canvas-snapshot.mjs).
// status: 'entregue' | 'em dev' | 'planejada' (fases 1 e 2) | 'futuro' (fase 3 em diante, "não é para agora")
// O app do tutor e o lojista no celular são React Native; lojista no computador, admin e site, Next.js.
const screenName = (s) => s.title.replace(/^\d+ · /, '');
const screenArea = (s) => (s.kind === 'app' ? 'app' : 'web');
const DELIVERED_AT_START = 8; // as primeiras telas da Fase 1 já estão no ar

// telas que o robô do canvas sente falta: não estão no canvas, mas o produto precisa
const MISSING_SCREENS = [
  ['Recuperar senha', 'O login não tem saída para quem esqueceu a senha.'],
  ['Excluir conta', 'A Apple e o Google exigem a opção em apps com cadastro.'],
  ['Erro no pagamento', 'O fluxo de Pix e cartão só tem a tela de sucesso.'],
  ['Editar pet', 'Existe o cadastro do pet, mas não há tela para editar os dados depois.'],
  ['Sem conexão (geral)', 'Só o mapa tem estado offline; as outras telas quebram sem internet.'],
];

const IDEAS = {
  dev: [
    ['Cache das listagens de pets com React Query', 'A tela de pets refaz a busca a cada navegação; com cache e staleTime de 30s some o loading repetido.'],
    ['Tipar as respostas da API com zod', 'Hoje os dados chegam como any; validar na borda evita tela quebrada quando a API muda.'],
    ['Paginação na linha do tempo do pet', 'Pets com muitos registros carregam a linha do tempo inteira de uma vez.'],
    ['Imagens do pet em WebP e next/image', 'As fotos de perfil pesam até 2 MB; dá para cortar ~80%.'],
    ['Lazy load das telas pesadas do app', 'O bundle inicial do React Native está carregando o chat e o mapa no boot.'],
  ],
  design: [
    ['Estados vazios ilustrados', 'A lista de lembretes vazia mostra só "Nenhum item"; uma ilustração com CTA "Criar lembrete" convida à ação.'],
    ['Contraste dos botões secundários', 'O cinza sobre branco não passa no WCAG AA.'],
    ['Cards de pet com cor por espécie', 'Ajuda a achar o pet certo rápido na lista.'],
    ['Modo escuro no app', 'Uso noturno é alto nos lembretes de remédio.'],
  ],
  ux: [
    ['Onboarding em 3 passos', 'Cadastro do primeiro pet logo após o login, em vez de cair numa home vazia.'],
    ['Adiar lembrete com um toque', 'Hoje, para adiar um remédio, o tutor precisa abrir e editar o lembrete.'],
    ['Lembrete de retorno após a consulta', 'Quem registra a consulta já marca o retorno, e o tutor recebe o aviso.'],
    ['Busca no painel admin por pet, tutor e telefone', 'O suporte procura o cliente pelo telefone na maioria das vezes.'],
  ],
};

// problemas de acessibilidade que o A11Y_01 procura nas telas entregues
const A11Y_ISSUES = [
  ['botões só com ícone, sem rótulo para o leitor de tela', 'Dar accessibilityLabel / aria-label a cada botão de ícone.'],
  ['texto cinza claro abaixo de 4,5:1 de contraste', 'Escurecer o texto secundário até passar no WCAG AA.'],
  ['áreas de toque menores que 44 px', 'Aumentar o alvo dos ícones de ação para 44 × 44.'],
  ['ordem de foco pulando campos do formulário', 'Seguir a ordem visual no foco do teclado e do leitor de tela.'],
  ['informação passada só pela cor', 'Somar ícone ou texto ao status que hoje é só verde/vermelho.'],
];

// erros de produção que o OPS_01 pode ver no Sentry
const PROD_ERRORS = [
  ['TypeError: Cannot read properties of undefined (reading \'pet\')', 'alta'],
  ['Timeout ao salvar no backend (504)', 'média'],
  ['Crash ao abrir a câmera no Android 14', 'alta'],
  ['Imagem não carrega no iOS em rede lenta', 'baixa'],
  ['Push duplicado no lembrete', 'média'],
];

// sugestões esperando decisão ao mesmo tempo; a partir daí os robôs de melhorias esperam
const MAX_PENDING = 6;
// entregas em develop que fazem o OPS_01 propor um release
const RELEASE_BATCH = 4;
// quantas vezes uma task volta antes de virar reunião
const MEETING_AFTER = 2;
const MEETING_TICKS = 8;

// [gravidade, falha, como corrigir, área] — sem área vale para web e app
const VULNS = [
  ['alta', 'SQL injection na busca', 'Usar query parametrizada em vez de concatenar o termo digitado.'],
  ['alta', 'IDOR: tutor acessa o pet de outro tutor', 'Conferir na API se o recurso pertence a quem está logado.'],
  ['alta', 'Chave secreta exposta no bundle', 'Tirar o segredo da variável NEXT_PUBLIC_ e chamar pelo servidor.', 'web'],
  ['média', 'XSS no campo de observações', 'Não renderizar HTML do usuário; escapar ou sanitizar com DOMPurify.', 'web'],
  ['média', 'Token salvo no AsyncStorage sem criptografia', 'Guardar o token no SecureStore / Keychain.', 'app'],
  ['média', 'Upload de foto sem validar tipo e tamanho', 'Validar MIME e limite de tamanho no servidor.'],
  ['média', 'Rota sem checagem de permissão', 'Exigir o papel certo (admin) no middleware da rota.'],
  ['baixa', 'Login sem rate limit', 'Limitar tentativas por IP e por conta.'],
  ['baixa', 'Dependência com CVE conhecida', 'Atualizar o pacote para a versão corrigida.'],
  ['baixa', 'Deep link aceita qualquer origem', 'Validar o host e os parâmetros do link antes de navegar.', 'app'],
];

const ACTIVITY = {
  po: ['Lendo a task no board', 'Escrevendo critérios de aceite', 'Quebrando em subtarefas', 'Priorizando'],
  dev: ['Lendo o código', 'Escrevendo código', 'Escrevendo testes', 'Rodando testes locais', 'Ajustando o lint'],
  canvas: ['Lendo o canvas', 'Comparando as telas com o código', 'Procurando telas faltando', 'Atualizando o canvas'],
  sec: ['Lendo o diff', 'Procurando injeção e XSS', 'Conferindo autenticação e permissões', 'Checando segredos e dependências', 'Escrevendo o parecer'],
  audit: ['Auditando o código entregue', 'Rodando o scanner de dependências', 'Revisando as rotas da API', 'Procurando segredos no repositório', 'Escrevendo o parecer'],
  qaWeb: ['Subindo o ambiente', 'Rodando testes unitários', 'Testando a tela no Playwright', 'Conferindo critérios de aceite', 'Escrevendo o relatório'],
  qaApp: ['Gerando o build', 'Rodando testes unitários', 'Testando no emulador Android', 'Testando no simulador iOS', 'Escrevendo o relatório'],
  ops: ['Olhando o Sentry', 'Conferindo os builds da Vercel e do Expo', 'Vendo o uso de CPU e memória', 'Montando o release'],
  docs: ['Lendo o diff da entrega', 'Escrevendo o CHANGELOG', 'Atualizando o README'],
  data: ['Lendo os eventos de uso', 'Montando o funil', 'Comparando com a semana passada', 'Escrevendo o insight'],
  idea: { dev: 'Analisando o código', design: 'Revisando as telas', ux: 'Analisando os fluxos', a11y: 'Testando com leitor de tela' },
};

export function createSimulatedFeed({ intervalMs = 1400, historySize = 80 } = {}) {
  const listeners = new Set();
  const history = [];
  const audit = [];
  const alerts = [];
  const state = new Map();
  const board = [];
  const reports = [];
  const ideas = [];
  const delivered = [];
  const releases = [];
  const changelog = [];
  const incidents = [];
  const insights = [];
  const spend = { day: dayKey(), today: 0, series: [] };
  let timer = null;
  let seq = 100;
  let mergedTotal = 0;
  let ideaSeq = 0;
  let alertSeq = 0;
  let tickCount = 0;

  const byKind = (kind) => ROBOTS.filter((r) => r.kind === kind);
  const emit = () => listeners.forEach((fn) => fn({ type: 'sync' }));
  const keep = (list, max) => { if (list.length > max) list.splice(0, list.length - max); };

  // tudo o que acontece vai para o histórico recente e para o histórico completo
  const push = (robotId, message, { taskId = null, kind = 'evento' } = {}) => {
    const ts = new Date();
    history.push({ ts, robotId, message });
    keep(history, historySize);
    audit.push({ ts, actor: robotId, kind, text: message, taskId });
    keep(audit, 3000);
  };
  const alert = (level, text, { robotId = null, taskId = null, panel = null } = {}) => {
    alerts.push({ id: ++alertSeq, ts: new Date(), level, text, robotId, taskId, panel });
    keep(alerts, 60);
    audit.push({ ts: new Date(), actor: robotId || 'ESCRITÓRIO', kind: 'alerta', text, taskId });
  };
  const taskOf = (id) => board.find((t) => t.id === id);
  // um passo na vida da task: vai para a linha do tempo dela e para o histórico
  const step = (t, robotId, text) => {
    t.timeline.push({ ts: new Date(), robotId, text });
    push(robotId, text, { taskId: t.id });
  };
  // dev livre e sem correção esperando por ele: a correção volta antes de uma task nova
  const isFree = (d) => {
    const s = state.get(d.id);
    return s.status === 'idle' && !s.paused && !board.some((t) => t.column === 'rework' && t.dev === d.id);
  };
  const idle = (s, activity = 'Livre') => Object.assign(s, { status: 'idle', activity, taskId: null, progress: 0 });

  // o canvas de design: as telas (com o status no código) e o registro do que o robô do canvas fez
  const canvas = {
    title: CANVAS.title, url: CANVAS.url, version: CANVAS.version, syncedAt: new Date(CANVAS.syncedAt),
    screens: CANVAS.screens.map((s, i) => ({
      ...s, name: screenName(s), area: screenArea(s), taskId: null, outdated: false,
      status: s.phase >= 3 ? 'futuro' : s.phase === 1 && i < DELIVERED_AT_START ? 'entregue' : 'planejada',
    })),
    changes: [],
  };
  const screenOf = (file) => canvas.screens.find((s) => s.file === file);
  const logCanvas = (text) => {
    canvas.changes.push({ ts: new Date(), text });
    keep(canvas.changes, 40);
  };

  function addTask(area, title, scope, from, { origin = from ? 'idea' : 'board', urgent = false, screen = null } = {}) {
    const id = `#${++seq}`;
    const prefix = origin === 'security' || origin === 'ops' ? 'fix' : 'feat';
    const task = {
      id, title, area, scope, column: 'todo', dev: null, qa: null, branch: `${prefix}/${slug(title)}`,
      commits: [], tests: null, rework: 0, findings: [], returnedBy: null, from, origin, screen,
      createdAt: new Date(), mergedAt: null, cost: 0, timeline: [], aligned: false, released: null,
    };
    const sc = screen && screenOf(screen);
    if (sc) sc.taskId = id;
    // correção (segurança, produção) fura a fila: o P.O pega a primeira do backlog que tiver dev livre
    if (urgent) board.unshift(task);
    else board.push(task);
    task.timeline.push({ ts: new Date(), robotId: from || 'PO_01', text: `Entrou no Backlog${from ? ` (${from})` : ''}` });
    return task;
  }
  const pickVuln = (area) => {
    const [severity, title, fix] = pick(VULNS.filter((v) => !v[3] || v[3] === area));
    return { severity, title, fix, open: true };
  };
  const screenTask = (sc, from, opts) => addTask(sc.area, sc.name, slug(sc.file.replace(/\.dc\.html$/, '')), from, { screen: sc.file, ...opts });

  // estado inicial: o board já tem as telas da Fase 1 (MVP) que faltam, e todo mundo está livre.
  // Daqui em diante, tela nova só entra no board pela aprovação do dono (robô do canvas).
  canvas.screens.filter((sc) => sc.phase === 1 && sc.status === 'planejada').forEach((sc) => screenTask(sc));
  for (const r of ROBOTS) state.set(r.id, idle({ done: 0, commits: 0, cost: 0, paused: false }, r.kind === 'idea' ? 'Pausa' : 'Livre'));

  // ── reunião: task que volta duas vezes junta P.O, dev e quem devolveu ──
  let meeting = null;
  function maybeMeeting(t, reviewerId) {
    if (meeting || t.rework < MEETING_AFTER || t.aligned) return;
    const people = ['PO_01', t.dev, reviewerId].filter((id) => {
      const s = state.get(id);
      return s && !s.paused && (s.status === 'idle' || id === 'PO_01');
    });
    if (people.length < 2) return;
    for (const id of people) {
      const s = state.get(id);
      // o P.O larga o que estava refinando: a task volta para o backlog
      if (s.taskId && id === 'PO_01') { const pt = taskOf(s.taskId); if (pt && pt.column === 'refining') pt.column = 'todo'; }
      Object.assign(s, { status: 'meeting', taskId: t.id, progress: 0, activity: `Reunião sobre ${t.id}` });
    }
    meeting = { taskId: t.id, robots: people, until: tickCount + MEETING_TICKS };
    step(t, 'PO_01', `${t.id} voltou ${t.rework} vezes · reunião com ${people.join(', ')}`);
    alert('warn', `${t.id} voltou ${t.rework} vezes: P.O, dev e revisor foram para a sala de reunião`, { taskId: t.id, panel: 'board' });
  }
  function tickMeeting() {
    if (!meeting) return;
    for (const id of meeting.robots) state.get(id).progress = 1 - (meeting.until - tickCount) / MEETING_TICKS;
    if (tickCount < meeting.until) return;
    const t = taskOf(meeting.taskId);
    if (t) {
      t.aligned = true;
      step(t, 'PO_01', 'Reunião terminou: critérios de aceite ajustados e o caso de teste que falhava ficou claro');
    }
    for (const id of meeting.robots) idle(state.get(id));
    meeting = null;
  }

  function tickPo(r, s) {
    if (s.taskId) {
      const t = taskOf(s.taskId);
      s.progress += rand(0.25, 0.45);
      s.activity = ACTIVITY.po[Math.min(3, Math.floor(s.progress * 4))];
      if (s.progress < 1) return;
      const dev = byKind('dev').find((d) => d.area === t.area && isFree(d));
      if (!dev) { s.activity = `Aguardando dev ${t.area === 'web' ? 'Next.js' : 'React Native'} livre`; s.progress = 1; return; }
      Object.assign(t, { column: 'dev', dev: dev.id });
      const sc = t.screen && screenOf(t.screen);
      if (sc && sc.status !== 'entregue') sc.status = 'em dev';
      Object.assign(state.get(dev.id), { status: 'working', taskId: t.id, progress: 0, activity: 'Criando a branch' });
      step(t, r.id, `Critérios prontos · passou para ${dev.id}`);
      step(t, dev.id, `Pegou a task · branch ${t.branch}`);
      s.done++;
      idle(s);
      // segue direto para a próxima do backlog, sem deixar dev esperando uma rodada
    }
    // sugestão (melhoria ou tela do canvas) só entra no board com a aprovação do dono (approveIdea)
    const todo = board.filter((t) => t.column === 'todo');
    // só tira do backlog o que tem dev livre para pegar, na ordem de prioridade do board
    const free = new Set(byKind('dev').filter(isFree).map((d) => d.area));
    const next = todo.find((t) => free.has(t.area));
    if (!next) return;
    next.column = 'refining';
    Object.assign(s, { status: 'working', taskId: next.id, progress: 0, activity: ACTIVITY.po[0] });
    step(next, r.id, 'P.O pegou do board e começou a refinar');
  }

  function tickDev(r, s) {
    if (!s.taskId) {
      const back = board.find((t) => t.column === 'rework' && t.dev === r.id);
      if (!back) return;
      back.column = 'dev';
      const bySec = back.returnedBy === 'security';
      Object.assign(s, { status: 'working', taskId: back.id, progress: 0.55, activity: bySec ? 'Corrigindo a falha de segurança' : 'Corrigindo o que o QA apontou' });
      step(back, r.id, `Voltou para corrigir${bySec ? ` · ${back.findings.at(-1).title}` : ' o que o QA apontou'}`);
      return;
    }
    const t = taskOf(s.taskId);
    s.progress = Math.min(1, s.progress + rand(0.015, 0.045));
    if (t.rework === 0 || s.progress > 0.75) s.activity = ACTIVITY.dev[Math.min(4, Math.floor(s.progress * 5))];
    if (Math.random() < 0.09 || s.progress >= 1) {
      const fixing = t.rework && s.progress < 0.8;
      const secFix = fixing && t.returnedBy === 'security';
      const fixOrigin = t.origin === 'security' || t.origin === 'ops';
      const type = fixing ? 'fix' : s.progress > 0.7 && Math.random() < 0.4 ? 'test' : fixOrigin ? 'fix' : 'feat';
      const msg = secFix
        ? `fix(security): ${t.findings.at(-1).title.toLowerCase()}`
        : `${type}(${t.origin === 'security' ? 'security' : t.scope}): ${type === 'test' ? 'cobre ' : type === 'fix' && fixing ? 'corrige ' : ''}${t.title.toLowerCase()}`;
      t.commits.push({ sha: sha(), message: msg, ts: new Date() });
      s.commits++;
      s.activity = 'Commit e push';
      push(r.id, `Push em ${t.branch} · ${msg}`, { taskId: t.id });
    }
    if (s.progress < 1) return;
    t.findings.forEach((f) => (f.open = false));
    t.column = 'security';
    s.done++;
    step(t, r.id, 'Terminou e mandou para a revisão de segurança');
    idle(s);
  }

  function tickSec(r, s) {
    if (!s.taskId && !s.audit) {
      const next = board.find((t) => t.column === 'security' && !t.secBy);
      if (next) {
        next.secBy = r.id;
        Object.assign(s, { status: 'working', taskId: next.id, progress: 0, activity: ACTIVITY.sec[0] });
        step(next, r.id, 'Começou a revisão de segurança');
      } else if (Math.random() < 0.08) {
        Object.assign(s, { status: 'working', audit: true, progress: 0, activity: ACTIVITY.audit[0] });
      }
      return;
    }
    // auditoria do código já entregue: quando acha algo, abre correção no topo do backlog
    if (s.audit) {
      s.progress = Math.min(1, s.progress + rand(0.04, 0.08));
      s.activity = ACTIVITY.audit[Math.min(4, Math.floor(s.progress * 5))];
      if (s.progress < 1) return;
      s.audit = false;
      s.done++;
      const shipped = board.filter((t) => t.column === 'merged');
      if (shipped.length && Math.random() < 0.45) {
        const base = pick(shipped);
        const vuln = pickVuln(base.area);
        const t = addTask(base.area, `Corrigir ${vuln.title.charAt(0).toLowerCase()}${vuln.title.slice(1)}`, base.scope, r.id, { origin: 'security', urgent: true });
        t.findings.push({ ...vuln, in: base.id });
        step(t, r.id, `Auditoria achou falha ${vuln.severity} em ${base.id} · correção no topo do backlog`);
        if (vuln.severity === 'alta') alert('danger', `Falha alta de segurança: ${vuln.title} (${base.id}) · ${t.id} no topo do backlog`, { robotId: r.id, taskId: t.id, panel: 'board' });
      } else push(r.id, 'Auditoria do código entregue sem falhas');
      return idle(s);
    }
    const t = taskOf(s.taskId);
    s.progress = Math.min(1, s.progress + rand(0.18, 0.3));
    s.activity = ACTIVITY.sec[Math.min(4, Math.floor(s.progress * 5))];
    if (s.progress < 1) return;
    s.done++;
    t.secBy = null;
    // depois de uma correção (ou de uma reunião) é mais difícil sobrar furo
    const reviews = t.findings.length + (t.secOk || 0);
    if (Math.random() < (t.aligned ? 0.03 : reviews ? 0.08 : 0.3)) {
      const vuln = pickVuln(t.area);
      t.findings.push(vuln);
      Object.assign(t, { column: 'rework', returnedBy: 'security' });
      t.rework++;
      step(t, r.id, `Falha ${vuln.severity}: ${vuln.title} · voltou para ${t.dev}`);
      if (vuln.severity === 'alta') alert('danger', `Falha alta em ${t.id}: ${vuln.title}`, { robotId: r.id, taskId: t.id, panel: 'board' });
      idle(s);
      return maybeMeeting(t, r.id);
    }
    t.column = 'qa';
    t.secOk = (t.secOk || 0) + 1;
    step(t, r.id, `Segurança ok${t.findings.length ? ` · ${t.findings.length} falha(s) corrigida(s)` : ''} · mandou para o QA`);
    idle(s);
  }

  function tickQa(r, s) {
    const kind = r.area === 'web' ? 'qaWeb' : 'qaApp';
    if (!s.taskId) {
      const next = board.find((t) => t.column === 'qa' && !t.qa && t.area === r.area);
      if (!next) return;
      next.qa = r.id;
      Object.assign(s, { status: 'working', taskId: next.id, progress: 0, activity: ACTIVITY[kind][0] });
      step(next, r.id, 'Começou a testar');
      return;
    }
    const t = taskOf(s.taskId);
    s.progress = Math.min(1, s.progress + rand(0.03, 0.07));
    s.activity = ACTIVITY[kind][Math.min(4, Math.floor(s.progress * 5))];
    if (s.progress < 1) return;
    const total = Math.round(rand(18, 64));
    const ok = Math.random() < (t.aligned ? 0.97 : t.rework ? 0.92 : 0.75);
    const failed = ok ? 0 : Math.ceil(rand(1, 4));
    t.tests = { total, passed: total - failed, failed };
    s.done++;
    if (ok) {
      Object.assign(t, { column: 'merged', mergedAt: new Date() });
      mergedTotal++;
      const fixed = t.findings.length;
      reports.push({
        taskId: t.id, title: t.title, area: t.area, dev: t.dev, qa: r.id, branch: t.branch,
        commits: t.commits.length, tests: t.tests, rework: t.rework, ts: new Date(), cost: t.cost,
        security: { reviewer: 'SEC_01', findings: t.findings.map(({ severity, title }) => ({ severity, title })) },
        summary: `${t.title} implementado em ${t.branch} com ${t.commits.length} commits. Segurança: ${fixed ? `${fixed} falha(s) encontrada(s) e corrigida(s)` : 'sem falhas'}. ${total}/${total} testes passaram${t.rework ? ` após ${t.rework} correção(ões)` : ' na primeira rodada'}. Merge feito em ${OFFICE.baseBranch}; vai para ${OFFICE.productionBranch} no próximo release.`,
      });
      keep(reports, 40);
      step(t, r.id, `Aprovou · merge em ${OFFICE.baseBranch} · relatório pronto`);
    } else {
      Object.assign(t, { column: 'rework', qa: null, returnedBy: 'qa' });
      t.rework++;
      step(t, r.id, `Reprovou: ${failed} teste(s) falharam · voltou para ${t.dev}`);
      idle(s);
      return maybeMeeting(t, r.id);
    }
    idle(s);
  }

  // ── Operações: release para produção (com aprovação), erros de produção e builds ──
  const pendingIdeas = () => ideas.filter((i) => i.status === 'aguardando' && i.focus !== 'post' && i.focus !== 'divulgação');
  const addIdea = (r, idea) => {
    const id = `S${++ideaSeq}`;
    ideas.push({ id, by: r.id, ts: new Date(), status: 'aguardando', ...idea });
    // descarta as decididas mais antigas; as que esperam aprovação ficam
    const decided = ideas.findIndex((i) => i.status !== 'aguardando');
    if (ideas.length > 60 && decided >= 0) ideas.splice(decided, 1);
    push(r.id, `Sugeriu: ${idea.title} · aguardando sua aprovação`, { kind: 'sugestão' });
    alert('info', `${r.id} espera você: ${idea.title}`, { robotId: r.id, panel: 'ideas' });
    return id;
  };
  const marketing = createMarketing({ push, alert, addIdea, pick, rand, keep, canvas, board });
  const unreleased = () => board.filter((t) => t.column === 'merged' && !t.released);
  const nextVersion = () => `v1.${releases.length + 1}.0`;

  function tickOps(r, s) {
    if (s.status === 'idle') {
      if (Math.random() > 0.15) return;
      Object.assign(s, { status: 'working', progress: 0, activity: ACTIVITY.ops[0] });
      return;
    }
    s.progress = Math.min(1, s.progress + rand(0.08, 0.14));
    s.activity = ACTIVITY.ops[Math.min(3, Math.floor(s.progress * 4))];
    if (s.progress < 1) return;
    s.done++;
    idle(s);
    // release: só propõe; produção é decisão do dono
    const ready = unreleased();
    if (ready.length >= RELEASE_BATCH && !pendingIdeas().some((i) => i.focus === 'release')) {
      return addIdea(r, {
        focus: 'release', title: `Release ${nextVersion()} para produção`, tasks: ready.map((t) => t.id),
        detail: `${ready.length} entregas testadas em ${OFFICE.baseBranch}: ${ready.map((t) => t.title).join(', ')}. Aprovar faz o merge em ${OFFICE.productionBranch} e o deploy.`,
      });
    }
    // erro em produção numa tela já lançada: abre correção direto, como a segurança
    const live = board.filter((t) => t.released);
    if (live.length && Math.random() < 0.25) {
      const base = pick(live);
      const [error, severity] = pick(PROD_ERRORS);
      const count = Math.round(rand(3, 180));
      const t = addTask(base.area, `Corrigir erro em produção: ${base.title}`, base.scope, r.id, { origin: 'ops', urgent: true });
      incidents.push({ ts: new Date(), error, severity, count, taskId: t.id, in: base.id, release: base.released });
      keep(incidents, 30);
      step(t, r.id, `Sentry: "${error}" (${count} ocorrências) em ${base.id} · correção no topo do backlog`);
      alert(severity === 'alta' ? 'danger' : 'warn', `Erro em produção (${base.released}): ${error} · ${count} ocorrências · ${t.id} aberto`, { robotId: r.id, taskId: t.id, panel: 'releases' });
      return;
    }
    push(r.id, 'Produção estável · builds da Vercel e do Expo ok');
  }

  // DOCS_01: uma linha no CHANGELOG por entrega; nas versões, as notas para as lojas
  function tickDocs(r, s) {
    if (s.status === 'idle') {
      const next = board.find((t) => t.column === 'merged' && !t.documented);
      if (!next) return;
      next.documented = 'em andamento';
      Object.assign(s, { status: 'working', taskId: next.id, progress: 0, activity: ACTIVITY.docs[0] });
      return;
    }
    const t = taskOf(s.taskId);
    s.progress = Math.min(1, s.progress + rand(0.2, 0.35));
    s.activity = ACTIVITY.docs[Math.min(2, Math.floor(s.progress * 3))];
    if (s.progress < 1) return;
    s.done++;
    if (t) {
      t.documented = true;
      const kind = t.origin === 'security' || t.origin === 'ops' ? 'Corrigido' : 'Novo';
      changelog.push({ ts: new Date(), taskId: t.id, kind, text: `${kind}: ${t.title}` });
      keep(changelog, 80);
      step(t, r.id, 'Escreveu a linha do CHANGELOG');
    }
    idle(s);
  }

  // DATA_01: lê o uso das telas entregues; quando algo chama atenção, vira sugestão
  function tickData(r, s) {
    if (s.status === 'idle') {
      if (Math.random() > 0.06) return;
      Object.assign(s, { status: 'working', progress: 0, activity: ACTIVITY.data[0] });
      return;
    }
    s.progress = Math.min(1, s.progress + rand(0.05, 0.1));
    s.activity = ACTIVITY.data[Math.min(3, Math.floor(s.progress * 4))];
    if (s.progress < 1) return;
    s.done++;
    idle(s);
    const shipped = canvas.screens.filter((sc) => sc.status === 'entregue');
    if (!shipped.length) return;
    const sc = pick(shipped);
    const drop = Math.round(rand(8, 52));
    const uses = Math.round(rand(40, 2400));
    const text = `"${sc.name}": ${uses} acessos na semana, ${drop}% abandonam antes de concluir`;
    insights.push({ ts: new Date(), screen: sc.file, name: sc.name, uses, drop, text });
    keep(insights, 30);
    push(r.id, `Insight: ${text}`);
    if (drop >= 35 && pendingIdeas().length < MAX_PENDING) {
      addIdea(r, { focus: 'data', title: `Simplificar "${sc.name}"`, detail: `${drop}% de quem abre não conclui (${uses} acessos na semana). Rever os passos e os campos obrigatórios.`, screen: sc.file, area: sc.area, reopen: true });
    }
  }

  function tickIdea(r, s) {
    if (s.status === 'idle') {
      // com muitas sugestões esperando decisão, os robôs de melhorias param de sugerir
      if (pendingIdeas().length >= MAX_PENDING) return idle(s, 'Aguardando sua aprovação');
      if (Math.random() > 0.05) return idle(s, 'Pausa');
      Object.assign(s, { status: 'working', progress: 0, activity: ACTIVITY.idea[r.focus] });
      return;
    }
    s.progress += rand(0.02, 0.05);
    if (s.progress < 1) return;
    s.done++;
    idle(s, 'Pausa');
    // acessibilidade olha as telas que já estão no ar
    if (r.focus === 'a11y') {
      const shipped = canvas.screens.filter((sc) => sc.status === 'entregue');
      if (!shipped.length) return;
      const sc = pick(shipped);
      const [issue, fix] = pick(A11Y_ISSUES);
      return addIdea(r, { focus: 'a11y', title: `Acessibilidade em "${sc.name}"`, detail: `Encontrei ${issue}. ${fix}`, screen: sc.file, area: sc.area, reopen: true });
    }
    const used = new Set(ideas.map((i) => i.title));
    const options = IDEAS[r.focus].filter(([title]) => !used.has(title));
    const [title, detail] = options.length ? pick(options) : pick(IDEAS[r.focus]);
    addIdea(r, { focus: r.focus, title, detail });
  }

  // Robô do canvas: mantém canvas e código conversando. Numa rodada ele faz uma destas coisas:
  // marca no canvas as telas entregues; percebe artboard que mudou depois da entrega; sugere a
  // próxima tela do canvas que ainda não tem task; ou sugere uma tela que falta no canvas.
  // Tudo o que vira trabalho novo passa pela aprovação do dono, como as melhorias.
  function tickCanvas(r, s) {
    if (s.status === 'idle') {
      if (Math.random() > 0.12) return;
      Object.assign(s, { status: 'working', progress: 0, activity: ACTIVITY.canvas[0] });
      return;
    }
    s.progress = Math.min(1, s.progress + rand(0.06, 0.11));
    s.activity = ACTIVITY.canvas[Math.min(3, Math.floor(s.progress * 4))];
    if (s.progress < 1) return;
    s.done++;
    idle(s);

    const shipped = canvas.screens.filter((sc) => sc.taskId && taskOf(sc.taskId)?.column === 'merged' && (sc.status !== 'entregue' || sc.outdated));
    if (shipped.length) {
      for (const sc of shipped) {
        Object.assign(sc, { status: 'entregue', outdated: false });
        logCanvas(`Marcou "${sc.name}" como entregue (${sc.taskId})`);
      }
      return push(r.id, `Atualizou o canvas: ${shipped.length} tela(s) entregue(s)`);
    }
    const busy = new Set(pendingIdeas().map((i) => i.screen).filter(Boolean));
    if (pendingIdeas().length >= MAX_PENDING) return push(r.id, 'Canvas conferido · esperando você decidir as sugestões');

    const roll = Math.random();
    const live = canvas.screens.filter((sc) => sc.status === 'entregue' && !sc.outdated && !busy.has(sc.file));
    if (roll < 0.3 && live.length) {
      const sc = pick(live);
      sc.outdated = true;
      logCanvas(`Mudou no canvas: "${sc.name}" (o artboard foi editado depois da entrega)`);
      return addIdea(r, { focus: 'canvas', title: `Atualizar "${sc.name}" conforme o canvas`, detail: `O artboard mudou depois da entrega; o código está na versão antiga. ${sc.section}.`, screen: sc.file, area: sc.area, reopen: true });
    }
    const next = canvas.screens.find((sc) => sc.status === 'planejada' && !sc.taskId && !busy.has(sc.file));
    if (roll < 0.8 && next) {
      logCanvas(`"${next.name}" está no canvas e ainda não tem task`);
      return addIdea(r, { focus: 'canvas', title: `Implementar "${next.name}"`, detail: `${next.section} · ${next.phaseName}. Está no canvas e ainda não tem task no board.`, screen: next.file, area: next.area });
    }
    const asked = new Set(ideas.map((i) => i.title));
    const missing = MISSING_SCREENS.find(([name]) => !asked.has(`Nova tela: ${name}`));
    if (missing) {
      logCanvas(`Falta no canvas: "${missing[0]}"`);
      return addIdea(r, { focus: 'canvas', title: `Nova tela: ${missing[0]}`, detail: `${missing[1]} Desenhar no canvas e implementar.`, area: 'app' });
    }
    logCanvas('Canvas e código em dia');
    push(r.id, 'Canvas conferido · nada mudou');
  }

  const TICK = { po: tickPo, canvas: tickCanvas, dev: tickDev, sec: tickSec, qa: tickQa, ops: tickOps, docs: tickDocs, data: tickData, idea: tickIdea, ...marketing.ticks };

  // ── orçamento: cada rodada de trabalho custa; ao bater o limite do dia, pausa tudo ──
  let paused = false;
  let pauseReason = null;
  let budget = OFFICE.dailyBudgetUsd;
  function charge(r, s) {
    if (s.status !== 'working') return;
    const usd = rand(0.002, 0.009);
    s.cost += usd;
    spend.today += usd;
    const t = s.taskId && taskOf(s.taskId);
    if (t) t.cost += usd;
  }
  function checkBudget() {
    if (spend.day !== dayKey()) Object.assign(spend, { day: dayKey(), today: 0 });
    spend.series.push(spend.today);
    keep(spend.series, 120);
    if (!paused && spend.today >= budget) {
      setPaused(true, `orçamento do dia (US$ ${budget}) atingido`);
      alert('danger', `Orçamento do dia atingido (US$ ${spend.today.toFixed(2)}): o escritório pausou. Aumente o limite ou continue amanhã.`, { panel: 'metrics' });
    }
  }

  function tick() {
    tickCount++;
    if (!paused) {
      tickMeeting();
      for (const r of ROBOTS) {
        const s = state.get(r.id);
        if (s.paused || s.status === 'meeting') continue;
        TICK[r.kind](r, s);
        charge(r, s);
      }
      checkBudget();
    }
    delivered.push(mergedTotal);
    keep(delivered, 120);
    // o board não cresce para sempre: some com as entregas mais antigas que já foram para produção
    const gone = board.filter((t) => t.column === 'merged' && t.released);
    if (gone.length > 24) board.splice(board.indexOf(gone[0]), 1);
    api.updatedAt = new Date();
    emit();
  }

  // ── ações do dono ──
  // decisão sobre o que está aguardando: sugestão vira task no Backlog; release vai para produção
  function decideIdea(id, approved) {
    const idea = ideas.find((i) => i.id === id && i.status === 'aguardando');
    if (!idea) return;
    Object.assign(idea, { status: approved ? 'aprovada' : 'recusada', decidedAt: new Date() });
    audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'decisão', text: `${approved ? 'Aprovou' : 'Recusou'}: ${idea.title}` });
    // posts e divulgação são da agência de marketing
    if (marketing.decide(idea, approved)) return emit();
    if (!approved) {
      push(idea.by, `Você recusou: ${idea.title}`);
      return emit();
    }
    if (idea.focus === 'release') {
      const version = idea.title.match(/v[\d.]+/)?.[0] || nextVersion();
      const tasks = idea.tasks.map(taskOf).filter(Boolean);
      tasks.forEach((t) => { t.released = version; t.timeline.push({ ts: new Date(), robotId: 'OPS_01', text: `Foi para produção no ${version}` }); });
      const news = tasks.filter((t) => t.origin !== 'security' && t.origin !== 'ops').map((t) => t.title);
      const fixes = tasks.length - news.length;
      releases.push({
        version, ts: new Date(), tasks: tasks.map((t) => ({ id: t.id, title: t.title, area: t.area })),
        notes: `Novidades: ${news.join(', ') || '—'}.${fixes ? ` ${fixes} correção(ões) de estabilidade e segurança.` : ''}`,
      });
      push('OPS_01', `Deploy do ${version} em produção (${OFFICE.productionBranch}) aprovado por você`, { kind: 'release' });
      push('DOCS_01', `Notas do ${version} prontas para a App Store e o Google Play`);
      alert('info', `${version} em produção com ${tasks.length} entregas`, { robotId: 'OPS_01', panel: 'releases' });
      idea.taskId = version;
      return emit();
    }
    const sc = idea.screen && screenOf(idea.screen);
    let t;
    if (sc && !idea.reopen) {
      t = screenTask(sc, idea.by, { origin: 'idea' });
      t.title = idea.title.replace(/^Implementar "(.*)"$/, '$1');
    } else {
      // tela que já existe (canvas mudou, dados, acessibilidade): task nova sem tirar a tela do lugar
      const area = idea.area || (/\b(app|react native)\b/i.test(`${idea.title} ${idea.detail}`) ? 'app' : 'web');
      t = addTask(area, idea.title.replace(/^Nova tela: /, ''), sc ? slug(sc.file.replace(/\.dc\.html$/, '')) : idea.focus === 'dev' ? 'refactor' : 'ui', idea.by, { screen: sc?.file || null });
    }
    idea.taskId = t.id;
    push(idea.by, `Aprovada por você · virou ${t.id} no Backlog`, { taskId: t.id });
    emit();
  }

  // post da agência volta para ajuste com o comentário do dono
  function adjustIdea(id, note = '') {
    const idea = ideas.find((i) => i.id === id && i.status === 'aguardando' && i.focus === 'post');
    if (!idea) return;
    Object.assign(idea, { status: 'ajuste pedido', decidedAt: new Date() });
    audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'decisão', text: `Pediu ajuste em ${idea.title}${note ? `: ${note}` : ''}` });
    marketing.adjust(idea, note);
    emit();
  }

  function setPaused(value, reason = null) {
    paused = value;
    pauseReason = value ? reason || 'pausado por você' : null;
    if (!reason) audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'decisão', text: value ? 'Pausou o escritório' : 'Retomou o escritório' });
    api.paused = paused;
    api.pauseReason = pauseReason;
    emit();
  }

  // aumenta (ou reduz) o limite do dia; se a pausa foi pelo orçamento e agora cabe, o escritório volta
  function setBudget(usd) {
    budget = Math.max(1, Math.round(usd));
    api.budget = budget;
    audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'decisão', text: `Mudou o orçamento do dia para US$ ${budget}` });
    if (paused && /orçamento/.test(pauseReason || '') && spend.today < budget) setPaused(false);
    else emit();
  }

  function setRobotPaused(id, value) {
    const s = state.get(id);
    if (!s) return;
    s.paused = value;
    audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'decisão', text: `${value ? 'Pausou' : 'Retomou'} ${id}` });
    emit();
  }

  // muda a ordem do Backlog: o P.O sempre pega a primeira que tem dev livre
  function prioritize(taskId, beforeId = null) {
    const t = taskOf(taskId);
    if (!t || t.column !== 'todo') return false;
    board.splice(board.indexOf(t), 1);
    const before = beforeId ? taskOf(beforeId) : board.find((x) => x.column === 'todo');
    board.splice(before ? board.indexOf(before) : board.length, 0, t);
    const pos = board.filter((x) => x.column === 'todo').indexOf(t) + 1;
    audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'decisão', text: `Moveu ${t.id} para a posição ${pos} do Backlog`, taskId: t.id });
    t.timeline.push({ ts: new Date(), robotId: 'VOCÊ', text: `Você moveu para a posição ${pos} do Backlog` });
    emit();
    return true;
  }

  // Conversa com um robô. Na simulação as respostas saem do estado e do histórico; no motor real,
  // a pergunta vai para o agente daquele robô.
  function ask(robotId, text) {
    const r = robotById(robotId);
    const s = state.get(robotId);
    if (!r || !s) return Promise.resolve('Não conheço esse robô.');
    audit.push({ ts: new Date(), actor: 'VOCÊ', kind: 'conversa', text: `Para ${robotId}: ${text}` });
    const q = text.toLowerCase();
    const mine = history.filter((e) => e.robotId === robotId);
    const t = s.taskId && taskOf(s.taskId);
    let answer;
    const prio = q.match(/prioriz\w*\s+(#\d+)/);
    if (prio) {
      answer = prioritize(prio[1]) ? `Feito: ${prio[1]} é a próxima do Backlog. Pego assim que tiver dev livre da área.` : `${prio[1]} não está no Backlog, então não dá para priorizar.`;
    } else if (/^paus|para (de|o)/.test(q)) {
      setRobotPaused(robotId, true);
      answer = 'Pausei. Termino só quando você mandar continuar.';
    } else if (/^(continu|volta|retom)/.test(q)) {
      setRobotPaused(robotId, false);
      answer = 'Voltei ao trabalho.';
    } else if (/por ?que|motivo|devolv|reprov/.test(q)) {
      const why = [...mine].reverse().find((e) => /voltou|Reprovou|Falha|recus/i.test(e.message));
      answer = why ? `${why.message}.` : 'Não devolvi nem reprovei nada recentemente.';
    } else if (/custo|gast|quanto/.test(q)) {
      answer = `Gastei US$ ${s.cost.toFixed(2)} até agora${t ? `; a ${t.id} já custou US$ ${t.cost.toFixed(2)}` : ''}.`;
    } else if (t) {
      answer = `Estou em ${t.id} "${t.title}" (${Math.round(s.progress * 100)}%): ${s.activity.toLowerCase()}.${t.rework ? ` Ela já voltou ${t.rework} vez(es).` : ''}`;
    } else {
      answer = `${s.activity}. ${mine.length ? `Por último: ${mine.at(-1).message}.` : 'Ainda não fiz nada hoje.'}`;
    }
    audit.push({ ts: new Date(), actor: robotId, kind: 'conversa', text: answer });
    return Promise.resolve(answer);
  }

  const api = {
    history, audit, alerts, board, reports, ideas, delivered, canvas, releases, changelog, incidents, insights, spend,
    marketing: { pieces: marketing.pieces, promotions: marketing.promotions },
    updatedAt: new Date(),
    error: null,
    canDecide: true,
    paused: false,
    pauseReason: null,
    get meeting() { return meeting; },
    budget,
    getState: (id) => state.get(id),
    task: taskOf,
    approveIdea: (id) => decideIdea(id, true),
    rejectIdea: (id) => decideIdea(id, false),
    adjustIdea,
    setPaused: (v) => setPaused(v),
    setRobotPaused,
    setBudget,
    prioritize,
    ask,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // o primeiro tick (que já distribui o backlog) roda logo depois de quem chamou terminar de montar a UI
    start() { if (!timer) { timer = setInterval(tick, intervalMs); queueMicrotask(tick); } },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}
