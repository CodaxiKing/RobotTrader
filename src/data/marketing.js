// ─────────────────────────────────────────────────────────────
// Agência de marketing do escritório (zona 07). Faz os criativos e os vídeos das redes sociais do
// PetLive e só publica com a aprovação do dono.
//
// Uma peça passa por: pauta (MKT_LEAD) → roteiro (ROTEIRO_01, só vídeo) → texto (COPY_01) →
// criação (ARTE_01 para imagem, VIDEO_01 para vídeo) → avaliação (REVISOR_01: nota por critério;
// abaixo de 7,5 volta para ajuste) → aprovação do dono → agendado (SOCIAL_01 escolhe o horário) →
// publicado → métricas. Com as métricas, o MKT_LEAD propõe formas de divulgação, que também
// esperam o dono.
//
// Peça: { id, network, format, video, theme, angle, hook, caption, hashtags, script: [{ t, scene, line }],
//         visual: { palette, layout, headline }, stage, score, scores, feedback, fixBy, scheduledAt,
//         publishedAt, metrics: { reach, likes, comments, saves, clicks }, timeline, ideaId }
// ─────────────────────────────────────────────────────────────

export const NETWORKS = {
  instagram: { label: 'Instagram', formats: ['Carrossel', 'Reels', 'Post'] },
  tiktok: { label: 'TikTok', formats: ['Vídeo'] },
  youtube: { label: 'YouTube Shorts', formats: ['Short'] },
  facebook: { label: 'Facebook', formats: ['Post', 'Vídeo'] },
  linkedin: { label: 'LinkedIn', formats: ['Post'] },
};
const VIDEO = new Set(['Reels', 'Vídeo', 'Short']);

export const STAGES = [
  { id: 'roteiro', label: 'Roteiro' },
  { id: 'texto', label: 'Texto' },
  { id: 'criação', label: 'Criação' },
  { id: 'avaliação', label: 'Avaliação' },
  { id: 'ajuste', label: 'Ajuste' },
  { id: 'aprovação', label: 'Sua aprovação' },
  { id: 'agendado', label: 'Agendado' },
  { id: 'publicado', label: 'Publicado' },
];

// conteúdo de valor para tutores; os lançamentos do app entram por cima destes
const THEMES = [
  { topic: 'vacinas', hook: 'Seu pet está com as vacinas em dia?', angle: 'educativo', body: 'A carteirinha digital do PetLive avisa antes de cada dose vencer. Sem papel perdido, sem susto no veterinário.', cta: 'Baixe o PetLive e cadastre a carteirinha em 2 minutos.' },
  { topic: 'fogos', hook: '3 jeitos de acalmar o seu pet nos fogos', angle: 'dica', body: 'Cantinho escuro, som ambiente e nada de bronca. O PetLive tem um modo fogos e trovão com o passo a passo.', cta: 'Salve este post para a virada do ano.' },
  { topic: 'pet perdido', hook: 'O QR na coleira que trouxe o Thor de volta', angle: 'história', body: 'Quem achou o Thor escaneou a coleira e falou com a tutora na hora. A ficha do pet aparece no celular de quem encontra.', cta: 'Ative o QR da coleira no app.' },
  { topic: 'passeio', hook: 'Quanto o seu cachorro andou hoje?', angle: 'produto', body: 'O passeio com GPS mostra o trajeto, o tempo e a distância, e guarda o histórico de cada pet.', cta: 'Comece um passeio pelo app hoje.' },
  { topic: 'primeiros socorros', hook: 'Seu pet comeu chocolate. E agora?', angle: 'educativo', body: 'Saiba o que fazer nos primeiros minutos e encontre a clínica 24 h mais perto, direto no PetLive.', cta: 'Compartilhe com quem tem pet.' },
  { topic: 'pet sênior', hook: '5 sinais de que o seu pet está envelhecendo', angle: 'educativo', body: 'Mais sono, menos apetite e cuidado com as articulações. O PetLive acompanha a qualidade de vida do pet sênior.', cta: 'Conta aqui embaixo: quantos anos tem o seu?' },
  { topic: 'lojistas', hook: 'Sua agenda de banho e tosa no celular', angle: 'B2B', body: 'Lojistas no PetLive recebem pedidos, confirmam horários e acompanham a agenda sem planilha.', cta: 'Cadastre a sua loja.', network: 'linkedin' },
];
const PALETTES = [['#ffb703', '#023047'], ['#8ecae6', '#1d3557'], ['#f4a261', '#264653'], ['#e76f51', '#fff1e6'], ['#90be6d', '#283618'], ['#cdb4db', '#3d2c5c']];
const LAYOUTS = ['foto do pet + título grande', 'ilustração com lista', 'antes e depois', 'print do app no celular', 'pergunta em destaque'];

const CRITERIA = {
  gancho: 'O gancho demora: comece pela pergunta nos 2 primeiros segundos.',
  clareza: 'A mensagem tem duas ideias; fique com uma só.',
  marca: 'A marca aparece pouco: logo no fim e as cores do PetLive no fundo.',
  cta: 'O CTA está fraco: diga exatamente o que fazer ("baixe", "salve", "comente").',
  formato: 'O texto na tela está pequeno para o celular; aumente e corte palavras.',
};

// formas de divulgação que o MKT_LEAD pode propor
const PROMOTIONS = [
  ['Impulsionar o melhor post com R$ 50 por 3 dias', 'O post com mais salvamentos alcança gente parecida com quem já engajou. Público: tutores de 25-45 anos num raio de 30 km.'],
  ['Parceria com 5 petshops do bairro', 'QR do PetLive no balcão e no cartão de banho; em troca, a loja aparece no mapa do app.'],
  ['Collab com um influenciador pet local', 'Um Reels mostrando o passeio com GPS e o QR da coleira, com código de convite.'],
  ['Campanha no Google para "carteira de vacina pet"', 'Busca com intenção alta e concorrência baixa; anúncio levando direto para a loja de apps.'],
  ['Grupo de WhatsApp de tutores da cidade', 'Conteúdo de dica uma vez por semana, com link do app; vira canal de comunidade.'],
  ['Calendário de datas pet', 'Dia do Cachorro (26/08), Dia dos Animais (04/10), vacinação antirrábica: posts preparados com antecedência.'],
];

export function createMarketing({ push, alert, addIdea, pick, rand, keep, canvas, board }) {
  const pieces = [];
  const promotions = [];
  let seq = 0;
  const stageOf = (id) => pieces.filter((p) => p.stage === id);
  const step = (p, robotId, text) => {
    p.timeline.push({ ts: new Date(), robotId, text });
    push(robotId, `${p.id} · ${text}`);
  };
  const active = () => pieces.filter((p) => !['publicado', 'recusado'].includes(p.stage));
  const promoted = new Set();

  // ── MKT_LEAD: pauta (lançamento do app primeiro) e, com resultados, ideias de divulgação ──
  function newPiece(r) {
    const launch = board.find((t) => t.released && !promoted.has(t.id) && t.origin !== 'security' && t.origin !== 'ops');
    let theme;
    if (launch) {
      promoted.add(launch.id);
      theme = { topic: launch.title, hook: `Novo no PetLive: ${launch.title}`, angle: 'lançamento', body: `Acabou de chegar no app: ${launch.title.toLowerCase()}. Mais um passo para cuidar do seu pet num lugar só.`, cta: 'Atualize o app e experimente.', launch: launch.id };
    } else theme = pick(THEMES);
    const networkId = theme.network || pick(['instagram', 'instagram', 'tiktok', 'youtube', 'facebook']);
    const format = pick(NETWORKS[networkId].formats);
    const p = {
      id: `M${++seq}`, network: networkId, format, video: VIDEO.has(format), theme: theme.topic, angle: theme.angle, brief: theme,
      hook: theme.hook, caption: '', hashtags: [], script: [], visual: null, stage: VIDEO.has(format) ? 'roteiro' : 'texto',
      score: null, scores: null, feedback: [], fixBy: null, rounds: 0, scheduledAt: null, publishedAt: null,
      metrics: null, timeline: [], ideaId: null, by: null, ts: new Date(),
    };
    pieces.push(p);
    keep(pieces, 80);
    step(p, r.id, `Pauta: ${NETWORKS[networkId].label} · ${format} · "${p.hook}" (${theme.angle})`);
  }

  function proposePromotion(r) {
    const live = pieces.filter((p) => p.metrics);
    // uma proposta de cada vez: a próxima só depois que você decidir a anterior
    if (live.length < 2 || promotions.some((x) => x.status === 'aguardando')) return false;
    const used = new Set(promotions.map((x) => x.title));
    const next = PROMOTIONS.find(([title]) => !used.has(title));
    if (!next) return false;
    const best = [...live].sort((a, b) => (b.metrics.saves + b.metrics.comments) - (a.metrics.saves + a.metrics.comments))[0];
    const promo = { title: next[0], detail: `${next[1]} Melhor resultado até agora: ${best.id} "${best.hook}" (${best.metrics.reach} de alcance, ${best.metrics.saves} salvamentos).`, status: 'aguardando', ts: new Date() };
    promotions.push(promo);
    addIdea(r, { focus: 'divulgação', title: promo.title, detail: promo.detail, promo: promo.title });
    return true;
  }

  function tickLead(r, s) {
    if (s.status === 'idle') {
      if (Math.random() > 0.12) return;
      Object.assign(s, { status: 'working', progress: 0, activity: 'Montando a pauta da semana' });
      return;
    }
    s.progress = Math.min(1, s.progress + rand(0.15, 0.3));
    if (s.progress < 1) return;
    s.done++;
    Object.assign(s, { status: 'idle', activity: 'Livre', progress: 0 });
    if (active().length < 4) return newPiece(r);
    if (Math.random() < 0.25) proposePromotion(r);
  }

  // ── trabalho de cada criativo: pega a peça na sua etapa, produz e passa adiante ──
  function creative(stage, { speed, activity, accept = () => true, done }) {
    return (r, s) => {
      if (!s.piece) {
        const p = stageOf(stage).find((x) => !x.busy && accept(x, r));
        if (!p) return;
        p.busy = r.id;
        Object.assign(s, { status: 'working', piece: p.id, progress: 0, activity: activity(p) });
        return;
      }
      const p = pieces.find((x) => x.id === s.piece);
      s.progress = Math.min(1, s.progress + rand(...speed));
      if (s.progress < 1) return;
      p.busy = null;
      s.done++;
      done(p, r);
      Object.assign(s, { status: 'idle', piece: null, activity: 'Livre', progress: 0 });
    };
  }

  const tickScript = creative('roteiro', {
    speed: [0.1, 0.18],
    activity: (p) => `Roteiro de ${p.format.toLowerCase()} · ${p.theme}`,
    done(p, r) {
      const b = p.brief;
      const [first, ...rest] = b.body.replace(/\.$/, '').split('. ');
      p.script = [
        { t: '0-3s', scene: 'Close no pet olhando para a câmera; texto grande na tela', line: b.hook },
        { t: '3-10s', scene: 'Tutor com o celular; print do app aparecendo', line: `${first}.` },
        { t: '10-20s', scene: 'Passo a passo rápido na tela do app, com cortes a cada 2 s', line: rest.length ? `${rest.join('. ')}.` : 'Tudo num app só.' },
        { t: '20-25s', scene: 'Logo do PetLive e o pet de novo', line: b.cta },
      ];
      p.stage = 'texto';
      step(p, r.id, `Roteiro pronto: ${p.script.length} cenas, ${p.script.at(-1).t.split('-')[1]}`);
    },
  });

  const tickCopy = creative('texto', {
    speed: [0.15, 0.25],
    activity: (p) => `Legenda e texto · ${p.theme}`,
    done(p, r) {
      const b = p.brief;
      p.caption = `${b.hook}\n\n${b.body}\n\n👉 ${b.cta}`;
      p.hashtags = ['#petlive', '#pets', p.network === 'linkedin' ? '#petshop' : '#tutordepet', `#${b.topic.normalize('NFD').replace(/[̀-ͯ\s]/g, '').toLowerCase()}`, pick(['#cachorro', '#gato', '#vidadepet'])];
      p.stage = 'criação';
      step(p, r.id, `Legenda, texto na tela e ${p.hashtags.length} hashtags prontos`);
    },
  });

  const makeVisual = (p) => ({ palette: pick(PALETTES), layout: pick(LAYOUTS), headline: p.hook });
  const tickArt = creative('criação', {
    speed: [0.1, 0.2],
    activity: (p) => `Criativo ${p.format.toLowerCase()} · ${p.theme}`,
    accept: (p) => !p.video,
    done(p, r) {
      p.visual = makeVisual(p);
      if (p.format === 'Carrossel') p.slides = 5;
      p.stage = 'avaliação';
      step(p, r.id, `Criativo pronto: ${p.visual.layout}${p.slides ? `, ${p.slides} cards` : ''}`);
    },
  });
  const tickVideo = creative('criação', {
    speed: [0.06, 0.12],
    activity: (p) => `Editando ${p.format.toLowerCase()} · ${p.theme}`,
    accept: (p) => p.video,
    done(p, r) {
      p.visual = makeVisual(p);
      p.duration = 25;
      p.stage = 'avaliação';
      step(p, r.id, `Vídeo editado: ${p.duration}s, legendas queimadas, trilha em alta`);
    },
  });

  // ajustes voltam para quem resolve o ponto mais fraco: texto (COPY) ou peça (ARTE / VIDEO)
  const fixDone = (p, r) => {
    p.rounds++;
    p.stage = 'avaliação';
    step(p, r.id, `Ajustou: ${p.feedback.at(-1)}`);
  };
  const tickFixCopy = creative('ajuste', { speed: [0.2, 0.35], activity: (p) => `Ajustando o texto de ${p.id}`, accept: (p) => p.fixBy === 'copy', done: fixDone });
  const tickFixArt = creative('ajuste', { speed: [0.15, 0.3], activity: (p) => `Ajustando o criativo de ${p.id}`, accept: (p) => p.fixBy === 'art' && !p.video, done: fixDone });
  const tickFixVideo = creative('ajuste', { speed: [0.12, 0.25], activity: (p) => `Reeditando ${p.id}`, accept: (p) => p.fixBy === 'art' && p.video, done: fixDone });

  const tickCritic = creative('avaliação', {
    speed: [0.2, 0.35],
    activity: (p) => `Avaliando ${p.id} · ${p.format.toLowerCase()}`,
    done(p, r) {
      // cada rodada de ajuste melhora a peça
      const bump = p.rounds * 1.2;
      p.scores = Object.fromEntries(Object.keys(CRITERIA).map((k) => [k, Math.min(10, Math.round((rand(5.5, 9.6) + bump) * 10) / 10)]));
      p.score = Math.round((Object.values(p.scores).reduce((n, v) => n + v, 0) / 5) * 10) / 10;
      if (p.score >= 7.5 || p.rounds >= 3) {
        p.stage = 'aprovação';
        step(p, r.id, `Nota ${p.score.toFixed(1)} · aprovado pela agência, vai para você`);
        p.ideaId = addIdea(r, { focus: 'post', title: `${NETWORKS[p.network].label} · ${p.format}: "${p.hook}"`, detail: p.caption, piece: p.id });
        return;
      }
      const weakest = Object.entries(p.scores).sort((a, b) => a[1] - b[1])[0][0];
      p.feedback.push(CRITERIA[weakest]);
      p.fixBy = ['cta', 'clareza'].includes(weakest) ? 'copy' : 'art';
      p.stage = 'ajuste';
      step(p, r.id, `Nota ${p.score.toFixed(1)} · voltou para ajuste (${weakest})`);
    },
  });

  // ── SOCIAL_01: publica o que está agendado e acompanha os números de cada post ──
  function tickSocial(r, s) {
    const due = stageOf('agendado').find((p) => p.scheduledAt <= Date.now());
    if (due) {
      Object.assign(due, { stage: 'publicado', publishedAt: new Date(), metrics: { reach: 0, likes: 0, comments: 0, saves: 0, clicks: 0 } });
      s.done++;
      step(due, r.id, `Publicado no ${NETWORKS[due.network].label}`);
      alert('info', `Publicado: ${due.id} "${due.hook}" no ${NETWORKS[due.network].label}`, { robotId: r.id, panel: 'marketing' });
    }
    // números crescem nas primeiras horas e estabilizam
    for (const p of stageOf('publicado')) {
      const age = (Date.now() - p.publishedAt) / 1000;
      if (age > 120) continue;
      const k = (p.video ? 1.8 : 1) * (p.score || 7) / 7;
      p.metrics.reach += Math.round(rand(20, 140) * k);
      p.metrics.likes += Math.round(rand(1, 12) * k);
      p.metrics.comments += Math.random() < 0.4 ? 1 : 0;
      p.metrics.saves += Math.round(rand(0, 4) * k);
      p.metrics.clicks += Math.round(rand(0, 3) * k);
    }
    const busy = stageOf('agendado').length || stageOf('publicado').some((p) => (Date.now() - p.publishedAt) / 1000 < 120);
    Object.assign(s, busy ? { status: 'working', activity: stageOf('agendado').length ? 'Agenda de posts' : 'Acompanhando os números', progress: 0.5 } : { status: 'idle', activity: 'Livre', progress: 0 });
  }

  // ── decisões do dono ──
  function decide(idea, approved) {
    if (idea.focus === 'divulgação') {
      const promo = promotions.find((x) => x.title === idea.promo);
      if (promo) promo.status = approved ? 'aprovada' : 'recusada';
      if (approved) push('MKT_LEAD', `Divulgação aprovada por você: ${idea.title} · SOCIAL_01 vai preparar`);
      return true;
    }
    if (idea.focus !== 'post') return false;
    const p = pieces.find((x) => x.id === idea.piece);
    if (!p) return true;
    if (!approved) { p.stage = 'recusado'; step(p, 'MKT_LEAD', 'Você recusou o post'); return true; }
    // melhor horário: o SOCIAL_01 agenda alguns minutos à frente (na simulação, segundos)
    p.scheduledAt = Date.now() + rand(6000, 20000);
    p.stage = 'agendado';
    step(p, 'SOCIAL_01', `Você aprovou · agendado para ${new Date(p.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    return true;
  }
  // pedir ajuste: volta para a agência com o seu comentário
  function adjust(idea, note) {
    const p = pieces.find((x) => x.id === idea.piece);
    if (!p) return;
    p.feedback.push(`Pedido seu: ${note || 'refazer o gancho e a arte'}`);
    p.fixBy = /texto|legenda|cta|frase/i.test(note || '') ? 'copy' : 'art';
    p.stage = 'ajuste';
    step(p, 'MKT_LEAD', `Você pediu ajuste: ${note || 'refazer o gancho e a arte'}`);
  }

  // um robô com mais de um tipo de trabalho: termina o que pegou; livre, o trabalho novo vem antes do ajuste
  const route = (...jobs) => (r, s) => {
    if (s.piece) return s.job(r, s);
    for (const job of jobs) {
      job(r, s);
      if (s.piece) { s.job = job; return; }
    }
  };

  // para a simulação lembrar da agência ao recarregar a página
  const dump = () => ({ pieces, promotions, seq, promoted: [...promoted] });
  function load(data) {
    pieces.splice(0, pieces.length, ...(data.pieces || []).map((p) => ({ ...p, busy: null })));
    promotions.splice(0, promotions.length, ...(data.promotions || []));
    seq = data.seq || pieces.length;
    (data.promoted || []).forEach((id) => promoted.add(id));
  }

  return {
    pieces, promotions, dump, load,
    ticks: {
      mktlead: tickLead,
      script: route(tickScript),
      copy: route(tickCopy, tickFixCopy),
      art: route(tickArt, tickFixArt),
      video: route(tickVideo, tickFixVideo),
      critic: route(tickCritic),
      social: tickSocial,
    },
    decide, adjust,
  };
}
