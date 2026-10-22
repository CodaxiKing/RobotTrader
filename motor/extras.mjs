// Os robôs do motor além do fluxo principal. Cada um roda de tempos em tempos (config.extras) para
// não gastar à toa, e tudo o que vira trabalho novo espera a aprovação do dono.
//   DOCS_01    uma linha no CHANGELOG.md a cada merge; as notas de cada release (agente)
//   CANVAS_01  telas planejadas do canvas (snapshot) sem task viram sugestão; sem custo de agente
//   melhorias  CODE/PERF/DESIGN/UX/A11Y, um por vez: lê o código só para leitura e sugere uma melhoria
//   agência    pauta → roteiro (agente) → texto (agente) → arte no template da marca → avaliação (agente)
//              → aprovação → "pronto para postar". Publicar sozinho precisa da API da Meta, que não está ligada.
//   DATA_01    sem fonte de analytics ligada: fica parado e diz isso
import { ROBOTS } from '../src/data/robots.js';
import { NETWORKS, VIDEO, THEMES, brandVisual } from '../src/data/marketing.js';
import { parseJson } from './agents.mjs';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => new Date().toISOString();


export function createExtras({ config, state, agent, work, git, repoOf }) {
  const s = state.data;
  const cfg = config.extras || {};
  // no ensaio os intervalos valem em segundos, para dar para ver tudo funcionando
  const minutes = (n) => n * (config.dryRun ? 1000 : 60 * 1000);
  const last = { canvas: 0, ideas: 0, marketing: 0 };
  const busy = (id) => s.robots[id].status !== 'idle' || s.robots[id].paused;
  const pending = (filter) => s.ideas.filter((i) => i.status === 'aguardando' && filter(i));
  s.marketing ||= { pieces: [], promotions: [] };
  const pieces = s.marketing.pieces;

  function addIdea(robotId, idea) {
    const id = state.newIdeaId();
    s.ideas.push({ id, by: robotId, time: now(), status: 'aguardando', ...idea });
    state.push(robotId, `Sugeriu: ${idea.title} · aguardando sua aprovação`, { kind: 'sugestão' });
    state.alert('info', `${robotId} espera você: ${idea.title}`, { robotId, panel: 'ideas' });
    return id;
  }

  // ── DOCS_01 ──
  function onMerged(task) {
    if (cfg.docs === false) return;
    const kind = task.origin === 'security' || task.origin === 'ops' ? 'Corrigido' : 'Novo';
    work('DOCS_01', task, 'Escrevendo o CHANGELOG', async () => {
      await git.appendChangelog(repoOf(task), config.baseBranch, `${kind}: ${task.title} (${task.id})`);
      state.step(task, 'DOCS_01', 'Escreveu a linha do CHANGELOG.md');
    });
  }
  async function releaseNotes(tasks) {
    const list = tasks.map((t) => `- ${t.origin === 'security' || t.origin === 'ops' ? 'correção' : 'novo'}: ${t.title}`).join('\n');
    try {
      return await agent('DOCS_01', 'docs', null, { prompt: `Entregas desta versão:\n${list}` });
    } catch {
      return `Novidades: ${tasks.map((t) => t.title).join(', ')}.`;
    }
  }

  // ── CANVAS_01: telas do canvas que ainda não têm task ──
  function canvasTick() {
    const c = cfg.canvas;
    if (!c || busy('CANVAS_01') || Date.now() - last.canvas < minutes(c.everyMinutes || 30)) return;
    last.canvas = Date.now();
    work('CANVAS_01', null, 'Comparando o canvas com o board', async () => {
      if (pending((i) => i.focus === 'canvas').length >= 2) return;
      const asked = new Set(s.ideas.map((i) => i.screen).filter(Boolean));
      const next = s.canvas.screens.find((sc) => sc.phase <= (c.maxPhase || 1) && sc.status === 'planejada' && !sc.taskId && !asked.has(sc.file));
      if (!next) return state.push('CANVAS_01', 'Canvas conferido · todas as telas da fase já têm task');
      s.canvas.changes.push({ time: now(), text: `"${next.name}" está no canvas e ainda não tem task` });
      addIdea('CANVAS_01', { focus: 'canvas', title: `Implementar "${next.name}"`, detail: `${next.section} · ${next.phaseName}. Está no canvas e ainda não tem task no board.`, screen: next.file, area: next.kind === 'app' ? 'app' : 'web' });
    });
  }

  // ── melhorias: um robô por vez lê o código e sugere ──
  const FOCUS_PROMPT = {
    dev: 'qualidade do código, duplicação, tipagem e tratamento de erro',
    design: 'consistência visual das telas com a identidade (cores, tipografia, espaçamento)',
    ux: 'fluxos com passos demais, estados vazios e mensagens de erro',
    a11y: 'acessibilidade: rótulos para leitor de tela, contraste, áreas de toque e ordem de foco',
  };
  let ideaTurn = 0;
  function ideasTick() {
    const c = cfg.ideas;
    if (!c || Date.now() - last.ideas < minutes(c.everyMinutes || 120)) return;
    if (pending((i) => !['post', 'divulgação', 'release'].includes(i.focus)).length >= 6) return;
    const team = ROBOTS.filter((r) => r.kind === 'idea' && !busy(r.id));
    if (!team.length) return;
    last.ideas = Date.now();
    const r = team[ideaTurn++ % team.length];
    const area = ideaTurn % 2 ? 'web' : 'app';
    work(r.id, null, 'Analisando o código', async () => {
      const text = await agent(r.id, 'idea', null, { prompt: `Foco: ${FOCUS_PROMPT[r.focus] || FOCUS_PROMPT.dev}${r.id === 'PERF_01' ? ' (performance: renderizações, consultas, tamanho do bundle)' : ''}. Repositório: ${area}.`, cwd: config.repos[area].path });
      const idea = parseJson(text);
      addIdea(r.id, { focus: r.focus, title: idea.title, detail: idea.detail, area: idea.area === 'app' ? 'app' : area });
    });
  }

  // ── agência de marketing ──
  const stepPiece = (p, robotId, text) => { p.timeline.push({ ts: now(), robotId, text }); state.push(robotId, `${p.id} · ${text}`); };
  function newPiece() {
    const promoted = new Set(pieces.map((p) => p.launch).filter(Boolean));
    const launch = s.board.find((t) => t.released && !promoted.has(t.id) && t.origin !== 'security' && t.origin !== 'ops');
    const theme = launch
      ? { topic: launch.title, hook: `Novo no PetLive: ${launch.title}`, angle: 'lançamento', body: `Acabou de chegar no app: ${launch.title.toLowerCase()}.`, cta: 'Atualize o app e experimente.' }
      : pick(THEMES);
    const network = theme.network || pick(['instagram', 'instagram', 'tiktok', 'youtube', 'facebook']);
    const format = pick(NETWORKS[network].formats);
    const p = {
      id: `M${pieces.length + 1}`, network, format, video: VIDEO.has(format), theme: theme.topic, angle: theme.angle, brief: theme, launch: launch?.id || null,
      hook: theme.hook, caption: '', hashtags: [], script: [], visual: null, stage: VIDEO.has(format) ? 'roteiro' : 'texto',
      score: null, scores: null, feedback: [], fixBy: null, rounds: 0, metrics: null, timeline: [], ts: now(),
    };
    pieces.push(p);
    stepPiece(p, 'MKT_LEAD', `Pauta: ${NETWORKS[network].label} · ${format} · "${p.hook}"`);
  }
  const brief = (p) => `Rede: ${NETWORKS[p.network].label}, formato: ${p.format}. Tema: ${p.brief.topic} (${p.angle}).\nIdeia: ${p.brief.hook} ${p.brief.body} CTA: ${p.brief.cta}`;
  function pieceStep(stage, robotId, activity, fn) {
    if (busy(robotId)) return;
    const p = pieces.find((x) => x.stage === stage && !x.busy && (stage !== 'ajuste' || x.fixBy));
    if (!p) return;
    p.busy = robotId;
    work(robotId, null, `${activity} · ${p.id}`, async () => {
      try { await fn(p); } finally { p.busy = null; state.changed(); }
    });
  }
  function marketingTick() {
    const c = cfg.marketing;
    if (!c) return;
    const active = pieces.filter((p) => !['pronto', 'publicado', 'recusado'].includes(p.stage));
    if (!busy('MKT_LEAD') && active.length < (c.maxActive || 2) && Date.now() - last.marketing > minutes(c.everyMinutes || 180)) {
      last.marketing = Date.now();
      work('MKT_LEAD', null, 'Montando a pauta', async () => newPiece());
    }
    pieceStep('roteiro', 'ROTEIRO_01', 'Roteiro', async (p) => {
      p.script = parseJson(await agent('ROTEIRO_01', 'script', null, { prompt: brief(p) })).script || [];
      p.stage = 'texto';
      stepPiece(p, 'ROTEIRO_01', `Roteiro pronto: ${p.script.length} cenas`);
    });
    const writeCopy = async (p, note = '') => {
      const out = parseJson(await agent('COPY_01', 'copy', null, { prompt: `${brief(p)}${p.script.length ? `\nRoteiro: ${p.script.map((x) => x.line).join(' / ')}` : ''}${note ? `\nAjuste pedido: ${note}` : ''}` }));
      Object.assign(p, { hook: out.hook || p.hook, caption: out.caption || '', hashtags: out.hashtags || [] });
    };
    pieceStep('texto', 'COPY_01', 'Legenda', async (p) => {
      await writeCopy(p);
      p.stage = 'criação';
      stepPiece(p, 'COPY_01', 'Legenda e hashtags prontas');
    });
    // a arte sai do template da marca (sem modelo de imagem ligado); o vídeo usa a mesma capa
    for (const [robotId, video] of [['ARTE_01', false], ['VIDEO_01', true]]) {
      if (busy(robotId)) continue;
      const p = pieces.find((x) => x.stage === 'criação' && !x.busy && x.video === video);
      if (!p) continue;
      p.visual = brandVisual(p, pick);
      p.stage = 'avaliação';
      stepPiece(p, robotId, `${video ? 'Capa do vídeo' : 'Criativo'} no template "${p.visual.layout}"`);
    }
    pieceStep('avaliação', 'REVISOR_01', 'Avaliando', async (p) => {
      const out = parseJson(await agent('REVISOR_01', 'critic', null, { prompt: `${brief(p)}\nLegenda: ${p.caption}\nRoteiro: ${p.script.map((x) => `${x.t} ${x.line}`).join(' / ')}\nArte: ${p.visual?.layout}` }));
      p.scores = out.scores;
      p.score = Math.round((Object.values(out.scores).reduce((n, v) => n + Number(v), 0) / 5) * 10) / 10;
      if (p.score >= 7.5 || p.rounds >= 2) {
        p.stage = 'aprovação';
        stepPiece(p, 'REVISOR_01', `Nota ${p.score.toFixed(1)} · vai para você`);
        p.ideaId = addIdea('REVISOR_01', { focus: 'post', title: `${NETWORKS[p.network].label} · ${p.format}: "${p.hook}"`, detail: p.caption, piece: p.id });
      } else {
        p.feedback.push(out.feedback);
        Object.assign(p, { stage: 'ajuste', fixBy: 'copy' });
        stepPiece(p, 'REVISOR_01', `Nota ${p.score.toFixed(1)} · ajuste: ${out.feedback}`);
      }
    });
    pieceStep('ajuste', 'COPY_01', 'Ajustando', async (p) => {
      await writeCopy(p, p.feedback.at(-1));
      p.rounds++;
      p.stage = 'avaliação';
      stepPiece(p, 'COPY_01', `Ajustou: ${p.feedback.at(-1)}`);
    });
  }

  function decide(idea, approved) {
    if (idea.focus === 'divulgação') return true;
    if (idea.focus !== 'post') return false;
    const p = pieces.find((x) => x.id === idea.piece);
    if (!p) return true;
    if (!approved) { p.stage = 'recusado'; stepPiece(p, 'MKT_LEAD', 'Você recusou'); return true; }
    p.stage = 'pronto';
    stepPiece(p, 'SOCIAL_01', 'Aprovado por você · pronto para postar (a publicação automática precisa da API da Meta)');
    state.alert('info', `${p.id} pronto para postar: copie a legenda no painel de Marketing`, { robotId: 'SOCIAL_01', panel: 'marketing' });
    return true;
  }
  function adjust(id, note) {
    const idea = s.ideas.find((i) => i.id === id && i.status === 'aguardando' && i.focus === 'post');
    const p = idea && pieces.find((x) => x.id === idea.piece);
    if (!p) return;
    Object.assign(idea, { status: 'ajuste pedido', decidedAt: now() });
    p.feedback.push(`Pedido seu: ${note || 'refazer o gancho'}`);
    Object.assign(p, { stage: 'ajuste', fixBy: 'copy' });
    state.decision(`Pediu ajuste em ${idea.title}${note ? `: ${note}` : ''}`);
    stepPiece(p, 'MKT_LEAD', `Você pediu ajuste: ${note || 'refazer o gancho'}`);
  }

  // DATA_01 não tem de onde ler; deixa isso claro no escritório
  state.setRobot('DATA_01', { activity: 'Sem fonte de analytics ligada' });

  return {
    onMerged, releaseNotes, decide, adjust,
    tick() { canvasTick(); ideasTick(); marketingTick(); },
  };
}
