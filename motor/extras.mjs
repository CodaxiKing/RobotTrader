// Os robôs do motor além do fluxo principal. Cada um roda de tempos em tempos (config.extras) para
// não gastar à toa, e tudo o que vira trabalho novo espera a aprovação do dono.
//   DOCS_01    uma linha no CHANGELOG.md a cada merge; as notas de cada release (agente)
//   CANVAS_01  telas planejadas do canvas (snapshot) sem task viram sugestão, depois de um agente conferir no
//              código que a tela ainda não existe (se existe, vira "entregue" sem perguntar nada)
//   melhorias  CODE/PERF/DESIGN/UX/A11Y, um por vez: lê o código só para leitura e sugere uma melhoria que
//              ainda não foi sugerida nem está no board
//   agência    pauta → roteiro (agente) → texto (agente) → arte no template da marca, com foto do Pexels
//              (stock.mjs) quando há PEXELS_API_KEY → avaliação (agente)
//              → aprovação → publica sozinho com a API da Meta (META_ACCESS_TOKEN + META_PAGE_ID) e lê os
//              números; sem a chave, fica "pronto para postar" e você publica na mão
//              → com resultado de dois posts no ar, o MKT_LEAD propõe uma forma de divulgação por vez
//   OPS_01     erros de produção do Sentry (SENTRY_AUTH_TOKEN + config.sentry) viram incidente e sugestão
//              de correção para a sua aprovação
//   DATA_01    lê o uso das telas de config.analytics.url (ou ANALYTICS_URL); sem fonte, fica parado e diz isso
import { ROBOTS } from '../src/data/robots.js';
import { NETWORKS, VIDEO, nextTheme, brandVisual, PROMOTIONS } from '../src/data/marketing.js';
import { parseJson } from './agents.mjs';
import { createStock } from './stock.mjs';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => new Date().toISOString();
// título para comparar sugestões: sem acento, caixa, pontuação nem a marca do ensaio
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(ensaio\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();


export function createExtras({ config, state, agent, work, git, repoOf }) {
  const s = state.data;
  const cfg = config.extras || {};
  // no ensaio os intervalos valem em segundos, para dar para ver tudo funcionando
  const minutes = (n) => n * (config.dryRun ? 1000 : 60 * 1000);
  const last = { canvas: 0, ideas: 0, marketing: 0, promo: 0 };
  const busy = (id) => s.robots[id].status !== 'idle' || s.robots[id].paused;
  const pending = (filter) => s.ideas.filter((i) => i.status === 'aguardando' && filter(i));
  s.marketing ||= { pieces: [], promotions: [] };
  const pieces = s.marketing.pieces;
  const stock = createStock({ key: process.env.PEXELS_API_KEY, warn: (text) => state.alert('warn', text, { robotId: 'ARTE_01', panel: 'marketing' }) });

  function addIdea(robotId, idea) {
    const id = state.newIdeaId();
    s.ideas.push({ id, by: robotId, time: now(), status: 'aguardando', ...idea });
    state.push(robotId, `Sugeriu: ${idea.title} · aguardando sua aprovação`, { kind: 'sugestão' });
    // post e divulgação esperam você na aba Marketing; o resto, nas Aprovações
    state.alert('info', `${robotId} espera você: ${idea.title}`, { robotId, panel: ['post', 'divulgação'].includes(idea.focus) ? 'marketing' : 'ideas' });
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
      const area = next.kind === 'app' ? 'app' : 'web';
      // a tela pode já ter sido feita fora do board: confere no código antes de sugerir
      let check = {};
      try {
        check = parseJson(await agent('CANVAS_01', 'screenCheck', null, { prompt: `Tela "${next.name}" (${next.section}, arquivo do canvas ${next.file}). Ela já está implementada neste repositório (${area})?`, cwd: config.repos[area].path }));
      } catch (err) {
        if (err.planLimit) throw err; // plano acabou: a tarefa do CANVAS_01 espera e confere na volta
        /* outra falha: sugere, e você decide */
      }
      if (check.implemented) {
        Object.assign(next, { status: 'entregue', outdated: false });
        s.canvas.changes.push({ time: now(), text: `"${next.name}" já estava no código${check.evidence ? ` (${check.evidence})` : ''}: marcou como entregue` });
        state.push('CANVAS_01', `"${next.name}" já existe no código · marcou como entregue, sem sugerir`);
        last.canvas = 0; // confere a próxima tela na volta seguinte
        return;
      }
      s.canvas.changes.push({ time: now(), text: `"${next.name}" está no canvas e ainda não tem task` });
      addIdea('CANVAS_01', { focus: 'canvas', title: `Implementar "${next.name}"`, detail: `${next.section} · ${next.phaseName}. Está no canvas, não tem task no board e não achei no código.`, screen: next.file, area });
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
      // o que já foi sugerido (aprovado ou não) e o que está no board, para o agente não repetir
      const known = [
        ...s.ideas.filter((i) => !['post', 'divulgação', 'release'].includes(i.focus)).map((i) => `${i.title} (${i.status})`),
        ...s.board.map((t) => `${t.title} (${t.column === 'merged' ? 'entregue' : 'no board'})`),
      ].slice(-60);
      const avoid = known.length ? `\nJá sugerido ou no board (não repita):\n${known.map((k) => `- ${k}`).join('\n')}` : '';
      const text = await agent(r.id, 'idea', null, { prompt: `Foco: ${FOCUS_PROMPT[r.focus] || FOCUS_PROMPT.dev}${r.id === 'PERF_01' ? ' (performance: renderizações, consultas, tamanho do bundle)' : ''}. Repositório: ${area}.${avoid}`, cwd: config.repos[area].path });
      const idea = parseJson(text);
      if (idea.none || !idea.title) return state.push(r.id, 'Leu o código e não achou nada novo para sugerir');
      const seen = new Set([...s.ideas.map((i) => norm(i.title)), ...s.board.map((t) => norm(t.title))]);
      if (seen.has(norm(idea.title))) return state.push(r.id, `Descartou "${idea.title}": já foi sugerido ou está no board`);
      addIdea(r.id, { focus: r.focus, title: idea.title, detail: idea.detail, area: idea.area === 'app' ? 'app' : area });
    });
  }

  // ── agência de marketing ──
  const stepPiece = (p, robotId, text) => { p.timeline.push({ ts: now(), robotId, text }); state.push(robotId, `${p.id} · ${text}`); };
  function newPiece() {
    const promoted = new Set(pieces.map((p) => p.launch).filter(Boolean));
    const launch = s.board.find((t) => t.released && !promoted.has(t.id) && t.origin !== 'security' && t.origin !== 'ops');
    const theme = launch
      ? { topic: launch.title, photo: 'happy dog owner using phone', hook: `Novo no PetLive: ${launch.title}`, angle: 'lançamento', body: `Acabou de chegar no app: ${launch.title.toLowerCase()}.`, cta: 'Atualize o app e experimente.' }
      : nextTheme(pieces, pick);
    if (!theme) return state.push('MKT_LEAD', 'Você recusou todas as pautas · sem pauta nova até ter um lançamento do app');
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
  const brief = (p) => `Rede: ${NETWORKS[p.network].label}, formato: ${p.format}. Tema: ${p.brief.topic} (${p.angle}).\nGancho: ${p.brief.hook}\nTexto: ${p.brief.body}\nCTA: ${p.brief.cta}`;

  // ── publicação nas redes pela API da Meta (depois da sua aprovação) ──
  // Liga com META_ACCESS_TOKEN e META_PAGE_ID em motor/.env; sem isso, a peça fica "pronto para postar"
  // e você publica na mão. Publica foto (URL do Pexels) ou link; vídeo fica manual por enquanto.
  const metaOn = () => !!(process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID);
  const metaCaption = (p) => [p.caption, p.hashtags.join(' ')].filter(Boolean).join('\n\n');
  async function metaPublish(p) {
    if (p.video) throw new Error('vídeo precisa de upload manual (a API da Meta não publica por URL de vídeo)');
    const photo = /^https:\/\//.test(p.visual?.photo?.src || '') ? p.visual.photo.src : null;
    const endpoint = photo ? `https://graph.facebook.com/v21.0/${process.env.META_PAGE_ID}/photos` : `https://graph.facebook.com/v21.0/${process.env.META_PAGE_ID}/feed`;
    const body = photo ? { url: photo, caption: metaCaption(p) } : { message: metaCaption(p), link: 'https://petlive.app' };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(30000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error?.message || `a Meta respondeu ${res.status}`);
    return out.post_id || out.id;
  }
  async function metaMetrics(p) {
    const base = 'https://graph.facebook.com/v21.0';
    const token = process.env.META_ACCESS_TOKEN;
    const [ins, det] = await Promise.all([
      fetch(`${base}/${p.metaId}/insights?metric=post_impressions,post_clicks&access_token=${token}`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()),
      fetch(`${base}/${p.metaId}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0)&access_token=${token}`, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()),
    ]);
    if (det?.error) throw new Error(det.error.message);
    const val = (m) => ins?.data?.find((d) => d.metric === m)?.values?.[0]?.value || 0;
    p.metrics = {
      reach: val('post_impressions'),
      likes: det?.reactions?.summary?.total_count || 0,
      comments: det?.comments?.summary?.total_count || 0,
      saves: 0,
      clicks: val('post_clicks'),
    };
  }
  const brN = (n) => Number(n || 0).toLocaleString('pt-BR');
  function pieceStep(stage, robotId, activity, fn, accept = () => true) {
    if (busy(robotId)) return;
    const p = pieces.find((x) => x.stage === stage && !x.busy && (stage !== 'ajuste' || x.fixBy) && accept(x));
    if (!p) return;
    p.busy = robotId;
    work(robotId, null, `${activity} · ${p.id}`, async () => {
      try { await fn(p); } finally { p.busy = null; state.changed(); }
    });
  }
  // ── MKT_LEAD: com resultado dos posts no ar, propõe uma forma de divulgação por vez ──
  // Mesma regra da simulação: só com dois posts medidos, e só uma proposta esperando sua aprovação;
  // aprovada, ela aparece no painel de Marketing como "aprovada"
  function proposePromotion() {
    const live = pieces.filter((p) => p.metrics);
    if (live.length < 2 || s.marketing.promotions.some((x) => x.status === 'aguardando')) return false;
    const used = new Set(s.marketing.promotions.map((x) => x.title));
    const next = PROMOTIONS.find(([title]) => !used.has(title));
    if (!next) return false;
    const best = [...live].sort((a, b) => (b.metrics.saves + b.metrics.comments) - (a.metrics.saves + a.metrics.comments))[0];
    const promo = {
      title: next[0],
      detail: `${next[1]} Melhor post até agora: ${best.id} "${best.hook}" (${brN(best.metrics.reach)} de alcance, ${brN(best.metrics.comments)} comentários).`,
      status: 'aguardando', ts: now(),
    };
    s.marketing.promotions.push(promo);
    addIdea('MKT_LEAD', { focus: 'divulgação', title: promo.title, detail: promo.detail, promo: promo.title });
    return true;
  }
  function marketingTick() {
    const c = cfg.marketing;
    if (!c) return;
    const active = pieces.filter((p) => !['pronto', 'publicado', 'recusado'].includes(p.stage));
    if (!busy('MKT_LEAD') && active.length < (c.maxActive || 2) && Date.now() - last.marketing > minutes(c.everyMinutes || 180)) {
      last.marketing = Date.now();
      work('MKT_LEAD', null, 'Montando a pauta', async () => newPiece());
    }
    // com números no ar, o MKT_LEAD também propõe divulgação (uma por vez, esperando você)
    if (!busy('MKT_LEAD') && Date.now() - last.promo > minutes(c.everyMinutes || 180) && proposePromotion()) last.promo = Date.now();
    pieceStep('roteiro', 'ROTEIRO_01', 'Roteiro', async (p) => {
      p.script = parseJson(await agent('ROTEIRO_01', 'script', null, { prompt: brief(p) })).script || [];
      p.stage = 'texto';
      stepPiece(p, 'ROTEIRO_01', `Roteiro pronto: ${p.script.length} cenas`);
    });
    const writeCopy = async (p, note = '') => {
      const out = parseJson(await agent('COPY_01', 'copy', null, { prompt: `${brief(p)}${p.script.length ? `\nRoteiro: ${p.script.map((x) => x.line).join(' / ')}` : ''}${note ? `\nAjuste pedido: ${note}` : ''}` }));
      Object.assign(p, { hook: out.hook || p.hook, caption: out.caption || '', hashtags: out.hashtags || [], photoQuery: out.photo || p.photoQuery });
    };
    pieceStep('texto', 'COPY_01', 'Legenda', async (p) => {
      await writeCopy(p);
      p.stage = 'criação';
      stepPiece(p, 'COPY_01', 'Legenda e hashtags prontas');
    });
    // a arte sai do template da marca, com uma foto do banco de imagens quando o Pexels está ligado;
    // o vídeo usa a mesma capa, em pé
    for (const [robotId, video] of [['ARTE_01', false], ['VIDEO_01', true]]) {
      pieceStep('criação', robotId, video ? 'Capa do vídeo' : 'Criativo', async (p) => {
        const used = new Set(pieces.map((x) => x.visual?.photo?.id).filter(Boolean));
        const photo = await stock.photo(p.photoQuery || p.brief.photo, { portrait: video, skip: used });
        p.visual = brandVisual(p, pick, photo);
        p.stage = 'avaliação';
        stepPiece(p, robotId, `${video ? 'Capa do vídeo' : 'Criativo'} no template "${p.visual.layout}"${photo ? ` · foto de ${photo.author} (Pexels)` : ''}`);
      }, (x) => x.video === video);
    }
    pieceStep('avaliação', 'REVISOR_01', 'Avaliando', async (p) => {
      const out = parseJson(await agent('REVISOR_01', 'critic', null, { prompt: `${brief(p)}\nLegenda: ${p.caption}\nRoteiro: ${p.script.map((x) => `${x.t} ${x.line}`).join(' / ')}\nArte: ${p.visual?.layout}${p.visual?.photo ? `, foto: ${p.visual.photo.alt}` : ''}` }));
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
      // a arte é refeita com o texto novo (e uma foto nova, se o ajuste pediu outra imagem)
      p.stage = 'criação';
      stepPiece(p, 'COPY_01', `Ajustou: ${p.feedback.at(-1)}`);
    });
    // com a API da Meta ligada, o SOCIAL_01 publica sozinho depois da sua aprovação e lê os números;
    // se a publicação falhar, tenta de novo em 10 minutos (máximo 3) — depois a peça espera você postar na mão
    pieceStep('pronto', 'SOCIAL_01', 'Publicando', async (p) => {
      p.publishTries = (p.publishTries || 0) + 1;
      let metaId;
      try {
        metaId = await metaPublish(p);
      } catch (err) {
        p.publishFailedAt = now();
        stepPiece(p, 'SOCIAL_01', `Publicação falhou na ${p.publishTries}ª vez: ${err.message}`);
        if (p.publishTries >= 3) state.alert('warn', `${p.id}: a publicação automática falhou ${p.publishTries} vezes (${err.message}) · a peça continua pronta para postar na mão`, { robotId: 'SOCIAL_01', panel: 'marketing' });
        return; // não joga erro para o work: quem decide quando tentar de novo é o accept abaixo
      }
      Object.assign(p, { stage: 'publicado', publishedAt: now(), metaId, publishTries: 0 });
      stepPiece(p, 'SOCIAL_01', `Publicado no ${NETWORKS[p.network].label}${p.visual?.photo?.src ? ' com a foto do Pexels' : ''} · post ${metaId}`);
      state.alert('info', `${p.id} publicado no ${NETWORKS[p.network].label} · post ${metaId}`, { robotId: 'SOCIAL_01', panel: 'marketing' });
    }, (p) => metaOn() && (p.publishTries || 0) < 3 && Date.now() - new Date(p.publishFailedAt || 0).getTime() > 10 * 60e3);
    pieceStep('publicado', 'SOCIAL_01', 'Lendo os números do post', async (p) => {
      await metaMetrics(p);
      stepPiece(p, 'SOCIAL_01', `Números do post: ${brN(p.metrics.reach)} de alcance, ${brN(p.metrics.likes)} curtidas, ${brN(p.metrics.comments)} comentários`);
    }, (p) => !!p.metaId && !p.metrics);
  }

  function decide(idea, approved) {
    if (idea.focus === 'divulgação') {
      const promo = s.marketing.promotions.find((x) => x.title === idea.promo);
      if (promo) promo.status = approved ? 'aprovada' : 'recusada';
      if (approved) state.push('MKT_LEAD', `Divulgação aprovada por você: ${idea.title}`);
      return true;
    }
    if (idea.focus !== 'post') return false;
    const p = pieces.find((x) => x.id === idea.piece);
    if (!p) return true;
    if (!approved) { p.stage = 'recusado'; stepPiece(p, 'MKT_LEAD', 'Você recusou'); return true; }
    p.stage = 'pronto';
    stepPiece(p, 'SOCIAL_01', metaOn()
      ? 'Aprovado por você · o SOCIAL_01 publica agora na rede'
      : 'Aprovado por você · pronto para postar (a publicação automática precisa da API da Meta)');
    if (!metaOn()) state.alert('info', `${p.id} pronto para postar: copie a legenda no painel de Marketing`, { robotId: 'SOCIAL_01', panel: 'marketing' });
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

  // ── OPS_01: erros de produção (Sentry) viram incidente e sugestão de correção ──
  // Liga com SENTRY_AUTH_TOKEN em motor/.env e config.sentry.org/.project; sem isso, parado e avisando.
  const sentryCfg = config.sentry || {};
  const sentryOn = () => !!(process.env.SENTRY_AUTH_TOKEN && sentryCfg.org && sentryCfg.project);
  let lastSentry = 0;
  let sentrySaid = false;
  function sentryTick() {
    if (!sentryOn()) {
      if (!sentrySaid) {
        sentrySaid = true;
        state.setRobot('OPS_01', { activity: 'Sem fonte de erros de produção ligada (Sentry)' });
      }
      return;
    }
    if (busy('OPS_01') || Date.now() - lastSentry < minutes(sentryCfg.everyMinutes || 30)) return;
    lastSentry = Date.now();
    work('OPS_01', null, 'Lendo os erros de produção (Sentry)', async () => {
      let issues;
      try {
        const url = `https://sentry.io/api/0/projects/${sentryCfg.org}/${sentryCfg.project}/issues/?query=is:unresolved&statsPeriod=24h&limit=25`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`o Sentry respondeu ${res.status}${res.status === 401 ? ' (chave recusada)' : ''}`);
        issues = await res.json();
      } catch (err) {
        return state.push('OPS_01', `Não li o Sentry agora: ${err.message}`);
      }
      let novos = 0;
      for (const issue of issues) {
        const seen = s.incidents.find((i) => i.sentryId === issue.shortId);
        if (seen) { seen.count = Number(issue.count) || seen.count; seen.time = now(); continue; }
        if (novos >= 5) break; // poucos por volta: o resto entra na próxima
        const severity = issue.level === 'fatal' || issue.level === 'error' ? 'alta' : issue.level === 'warning' ? 'média' : 'baixa';
        s.incidents.push({ time: now(), severity, error: issue.title, count: Number(issue.count) || 1, release: issue.release?.version || null, sentryId: issue.shortId, url: issue.permalink, taskId: null });
        novos++;
        state.alert('warn', `Erro em produção (Sentry): ${issue.title} · ${issue.count}×`, { robotId: 'OPS_01', panel: 'releases' });
        addIdea('OPS_01', { focus: 'ops', title: `Corrigir erro em produção: ${issue.title}`, detail: `${issue.count}× nas últimas 24h${issue.release?.version ? ` · release ${issue.release.version}` : ''}\n${issue.permalink || ''}`, area: 'app', incident: issue.shortId });
      }
      state.keep(s.incidents, 100);
      state.push('OPS_01', novos ? `Achei ${novos} erro(s) novo(s) no Sentry · correção esperando sua aprovação` : 'Sentry conferido · sem erro novo');
    });
  }

  // ── DATA_01: uso das telas a partir de uma fonte de analytics ──
  // config.analytics.url (ou ANALYTICS_URL) devolve { "screens": [{ "name": "Início", "views": 1230 }] };
  // compara com a leitura anterior e avisa quando o uso de uma tela cai mais de 40%.
  const analyticsUrl = () => config.analytics?.url || process.env.ANALYTICS_URL;
  let lastData = 0;
  let lastViews = null;
  function analyticsTick() {
    const url = analyticsUrl();
    if (!url || busy('DATA_01') || Date.now() - lastData < minutes(config.analytics?.everyMinutes || 60)) return;
    lastData = Date.now();
    work('DATA_01', null, 'Lendo o uso das telas', async () => {
      let out;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`a fonte respondeu ${res.status}`);
        out = await res.json();
      } catch (err) {
        return state.push('DATA_01', `Não li o analytics agora: ${err.message}`);
      }
      const screens = (Array.isArray(out) ? out : out.screens || [])
        .map((x) => ({ name: x.name || x.screen || x.path, views: Number(x.views || x.count || 0) }))
        .filter((x) => x.name);
      if (!screens.length) return state.push('DATA_01', 'A fonte de analytics devolveu nada de uso');
      const top = [...screens].sort((a, b) => b.views - a.views).slice(0, 5);
      s.insights.push({ time: now(), text: `Telas mais vistas: ${top.map((t) => `${t.name} ${brN(t.views)}`).join(' · ')}` });
      state.keep(s.insights, 200);
      if (lastViews) {
        const queda = screens.filter((x) => (lastViews.get(x.name) || 0) > 100 && x.views < lastViews.get(x.name) * 0.6);
        if (queda.length) state.alert('warn', `Uso caiu mais de 40% nas últimas leituras: ${queda.map((q) => `${q.name} (${brN(lastViews.get(q.name))} → ${brN(q.views)})`).join(', ')}`, { robotId: 'DATA_01', panel: 'today' });
      }
      lastViews = new Map(screens.map((x) => [x.name, x.views]));
      state.push('DATA_01', `Leu o uso das telas: ${top[0].name} no topo com ${brN(top[0].views)}`);
    });
  }

  // sem fonte de analytics ligada, o DATA_01 deixa isso claro no escritório
  if (!analyticsUrl()) state.setRobot('DATA_01', { activity: 'Sem fonte de analytics ligada' });

  return {
    onMerged, releaseNotes, decide, adjust,
    tick() { canvasTick(); ideasTick(); marketingTick(); sentryTick(); analyticsTick(); },
  };
}
