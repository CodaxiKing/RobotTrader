// Painéis da interface (o overlay): board, canvas, aprovações, agência, relatórios, produção,
// resumo do dia, métricas, histórico, e o detalhe de uma task ou de um criativo.
// Cada painel tem title e html() (e shell(), quando parte dele não pode ser redesenhada).
import { OFFICE, COLUMNS, robotById } from '../data/robots.js';
import { AREA, FOCUS, SEVERITY, SCREEN, screenState, fmtTime, doneLabel } from '../screens.js';
import { computeMetrics, buildToday, usd } from '../data/stats.js';
import { NETWORKS, STAGES, BRAND } from '../data/marketing.js';
import { esc, who, fmtN } from './html.js';

// root(): o elemento do overlay, para o histórico ler a busca que o dono digitou
// account(): a conta Claude que o motor está usando (GET /api/account), ou null; live: se há motor
export function createPanels({ feed, root, account = () => null, live = false }) {
  // link do pull request no GitHub (o motor abre um por task)
  const prLink = (pr) => (pr?.url ? ` · <a class="pr-link" href="${esc(pr.url)}" target="_blank" rel="noopener">PR #${esc(pr.number)}</a>` : '');
  const ORIGIN = {
    security: (t) => `🛡 achado da auditoria de ${who(t.from)}`,
    ops: (t) => `⚠ erro em produção visto por ${who(t.from)}`,
    idea: (t) => `sugestão de ${who(t.from)}, aprovada por você`,
  };

  // prévia de um criativo da agência no template da marca (BRAND / TEMPLATES em data/marketing.js);
  // antes da arte ficar pronta, um cartão neutro só com o gancho
  const dog = '<i class="pet-dog" aria-hidden="true"><i></i><i></i><i></i></i>';
  const creative = (p, size = '') => {
    const v = p.visual;
    const meta = `<span class="net">${esc(NETWORKS[p.network].label)} · ${esc(p.format)}</span>${p.video ? '<i class="play">▶</i>' : ''}${p.slides ? `<i class="slides">1/${p.slides}</i>` : ''}`;
    if (!v?.template) {
      return `<div class="creative draft ${p.video ? 'is-video' : ''} ${size}">${meta}<b>${esc(v?.headline || p.hook)}</b><small>${v ? esc(v.layout) : 'arte ainda não feita'}</small></div>`;
    }
    const fam = BRAND.families[v.family] || BRAND.families.azul;
    const style = `--fam-bg:${fam.bg};--fam-text:${fam.text}`;
    const title = `<b class="cr-title">${esc(v.headline)}</b>`;
    const cta = `<span class="cr-cta">${esc(v.cta.replace(/\.$/, ''))}</span>`;
    const logo = '<span class="cr-logo">PetLive</span>';
    const photo = /^https:\/\//.test(v.photo?.src || '') ? ` style="background-image:url(&quot;${esc(v.photo.src)}&quot;)" role="img" aria-label="${esc(v.photo.alt)}"` : '';
    const body = {
      onda: `<div class="cr-head${photo ? ' has-photo' : ''}"${photo}>${photo ? '' : dog}</div>${title}${cta}${logo}`,
      foto: `<span class="cr-photo"${photo}></span>${title}${cta}${logo}`,
      cartao: `${title}<ul class="cr-points">${v.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${logo}`,
      pergunta: `<span class="cr-tag">PetLive explica</span>${title}${cta}${logo}`,
      app: `${title}<span class="cr-phone"><i></i><i></i><i></i></span>${logo}`,
    }[v.template];
    return `<div class="creative tpl-${v.template} ${p.video ? 'is-video' : ''} ${size}" style="${style}" title="${esc(v.layout)}">${meta}${body}</div>`;
  };

  function pieceHtml(id) {
    const p = feed.marketing?.pieces.find((x) => x.id === id);
    if (!p) return '<p class="empty">Essa peça não existe mais.</p>';
    const idea = feed.ideas.find((i) => i.piece === p.id && i.status === 'aguardando');
    return `
      <div class="piece">
        <div class="piece-preview">${creative(p, 'big')}
          ${p.visual?.photo ? `<p class="photo-credit">Foto: <a href="${esc(p.visual.photo.authorUrl)}" target="_blank" rel="noopener">${esc(p.visual.photo.author)}</a> no <a href="${esc(p.visual.photo.page)}" target="_blank" rel="noopener">Pexels</a> · busca "${esc(p.visual.photo.query)}"</p>` : ''}
          ${p.score != null ? `<div class="scores">${Object.entries(p.scores).map(([k, v]) => `<span class="${v >= 7.5 ? 'ok' : 'low'}">${esc(k)} <b>${v.toFixed(1)}</b></span>`).join('')}<span class="total">nota <b>${p.score.toFixed(1)}</b></span></div>` : ''}
          ${idea && feed.canDecide ? `<div class="decide"><button data-approve="${esc(idea.id)}">✔ Aprovar e agendar</button><button data-adjust="${esc(idea.id)}" class="mid">✎ Pedir ajuste</button><button data-reject="${esc(idea.id)}" class="no">Recusar</button></div>` : ''}
        </div>
        <div class="piece-info">
          <div class="kv-row"><span>Etapa <b>${esc(STAGES.find((x) => x.id === p.stage)?.label || p.stage)}</b></span><span>Pauta <b>${esc(p.angle)}</b></span>${p.scheduledAt && p.stage === 'agendado' ? `<span>Agendado <b>${new Date(p.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b></span>` : ''}</div>
          ${p.metrics ? `<div class="tiles">${[['Alcance', p.metrics.reach], ['Curtidas', p.metrics.likes], ['Comentários', p.metrics.comments], ['Salvamentos', p.metrics.saves], ['Cliques no link', p.metrics.clicks]].map(([k, v]) => `<div class="tile"><small>${k}</small><b>${fmtN(v)}</b></div>`).join('')}</div>` : ''}
          <div class="ov-floor">Legenda</div>
          ${p.caption ? `<pre class="caption">${esc(p.caption)}\n\n${esc(p.hashtags.join(' '))}</pre><button class="copy" data-copy="${esc(`${p.caption}\n\n${p.hashtags.join(' ')}`)}">Copiar legenda</button>` : '<p class="empty">O COPY_01 ainda não escreveu.</p>'}
          ${p.script.length ? `<div class="ov-floor">Roteiro (${esc(p.format)})</div><table class="script"><tbody>${p.script.map((c) => `<tr><td>${esc(c.t)}</td><td>${esc(c.scene)}</td><td>“${esc(c.line)}”</td></tr>`).join('')}</tbody></table>` : ''}
          ${p.feedback.length ? `<div class="ov-floor">Ajustes pedidos</div><ul class="changes one">${p.feedback.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          <div class="ov-floor">Linha do tempo</div>
          <ol class="timeline">${p.timeline.map((e) => `<li><time>${fmtTime(new Date(e.ts))}</time><b>${who(e.robotId)}</b> ${esc(e.text)}</li>`).join('')}</ol>
        </div>
      </div>`;
  }

  const PANELS = {
    marketing: {
      title: 'Agência de marketing · criativos e vídeos',
      html: () => {
        const m = feed.marketing;
        if (!m) return '<p class="empty">A agência de marketing ainda não está ligada no motor; ela roda na simulação.</p>';
        const live = m.pieces.filter((p) => p.metrics);
        const sum = (k) => live.reduce((n, p) => n + p.metrics[k], 0);
        const waiting = feed.ideas.filter((i) => ['post', 'divulgação'].includes(i.focus) && i.status === 'aguardando').length;
        const tiles = [['Publicados', live.length], ['Alcance', sum('reach')], ['Curtidas e comentários', sum('likes') + sum('comments')], ['Salvamentos', sum('saves')], ['Cliques no link', sum('clicks')]];
        return `
          <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${k}</small><b>${fmtN(v)}</b></div>`).join('')}</div>
          ${waiting ? `<button data-open="ideas" class="today-cta mkt-cta">${waiting} post(s) e ideia(s) de divulgação esperando a sua aprovação →</button>` : '<p class="panel-hint">Nada publica sem você: cada criativo aprovado pela agência vem para a sua aprovação antes de ir para as redes.</p>'}
          <div class="mkt-board">${STAGES.map((st) => {
            const list = m.pieces.filter((p) => p.stage === st.id).slice(-8).reverse();
            return `<section class="col"><h4>${esc(st.label)} <b>${m.pieces.filter((p) => p.stage === st.id).length}</b></h4>${list.map((p) => `
              <article class="piece-card" data-piece="${esc(p.id)}">${creative(p)}<div class="pc-meta"><b>${esc(p.id)}</b>${p.score != null ? ` · nota ${p.score.toFixed(1)}` : ''}${p.metrics ? ` · ${fmtN(p.metrics.reach)} de alcance` : ''}</div></article>`).join('') || '<p class="empty">vazio</p>'}</section>`;
          }).join('')}</div>
          <div class="ov-floor">Divulgação</div>
          ${m.promotions.length ? `<ul class="changes one">${m.promotions.slice().reverse().map((x) => `<li><b class="promo ${esc(x.status)}">${esc(x.status)}</b> ${esc(x.title)} <small>${esc(x.detail)}</small></li>`).join('')}</ul>` : '<p class="empty">O MKT_LEAD propõe formas de divulgação quando houver resultado dos primeiros posts.</p>'}`;
      },
    },
    board: {
      title: 'Board do GitHub · PetLive',
      html: () => `<p class="panel-hint">Arraste os cards do Backlog para mudar a prioridade: o P.O sempre pega o primeiro que tem dev livre. Clique num card para ver a linha do tempo.</p>
        <div class="kanban">${COLUMNS.map((c) => {
        const tasks = feed.board.filter((t) => t.column === c.id);
        // o Backlog aparece na ordem de prioridade; as outras colunas, a mais recente em cima
        const shown = c.id === 'todo' ? tasks.slice(0, 14) : tasks.slice(-14).reverse();
        return `<section class="col col-${c.id}" data-col="${c.id}"><h4>${esc(c.label)} <b>${tasks.length}</b></h4>${shown.map((t, i) => {
          const open = (t.findings || []).filter((f) => f.open);
          const fix = t.origin === 'security' || t.origin === 'ops';
          return `
          <article class="task-card${fix ? ' sec-fix' : ''}" data-task="${esc(t.id)}" ${c.id === 'todo' ? 'draggable="true"' : ''} style="--a:${fix ? SEVERITY.alta : AREA[t.area].color}">
            <div class="tc-top"><b>${c.id === 'todo' ? `<i class="prio">${i + 1}</i>` : ''}${esc(t.id)}</b><span class="area">${AREA[t.area].label}</span></div>
            <div class="tc-title">${esc(t.title)}</div>
            ${open.map((f) => `<div class="finding" style="--s:${SEVERITY[f.severity]}"><b>${esc(f.severity)}</b> ${esc(f.title)}<small>${esc(f.fix)}</small></div>`).join('')}
            <div class="tc-meta">${t.dev ? `dev ${who(t.dev)}` : ORIGIN[t.origin]?.(t) || 'aguardando o P.O'}${t.secBy ? ` · revisão ${who(t.secBy)}` : ''}${t.qa ? ` · QA ${who(t.qa)}` : ''}${t.commits?.length ? ` · ${t.commits.length} commits` : ''}${t.rework ? ` · ${t.rework}× correção` : ''}${t.findings?.length && !open.length ? ` · 🛡 ${t.findings.length} corrigida(s)` : ''}${t.released ? ` · ${esc(t.released)} em produção` : ''}${t.cost ? ` · ${usd(t.cost)}` : ''}${prLink(t.pr)}</div>
          </article>`;
        }).join('') || '<p class="empty">vazio</p>'}</section>`;
      }).join('')}</div>`,
    },
    reports: {
      title: 'Relatórios do QA',
      html: () => (feed.reports.length ? feed.reports.slice().reverse().map((r) => `
        <article class="report" style="--a:${AREA[r.area].color}" data-task="${esc(r.taskId)}">
          <header><b>${esc(r.taskId)}</b> ${esc(r.title)} <span class="ok">✔ merge em ${esc(OFFICE.baseBranch)}</span><time>${fmtTime(r.ts)}</time></header>
          <p>${esc(r.summary)}</p>
          <div class="kv-row">
            <span>Área <b>${AREA[r.area].label}</b></span><span>Dev ${who(r.dev)}</span><span>QA ${who(r.qa)}</span>
            <span>Branch <code>${esc(r.branch)}</code></span><span>Commits <b>${r.commits}</b></span>
            <span>Testes <b>${r.tests.passed}/${r.tests.total}</b></span><span>Correções <b>${r.rework}</b></span>${r.pr?.url ? `<span><a class="pr-link" href="${esc(r.pr.url)}" target="_blank" rel="noopener">PR #${esc(r.pr.number)} no GitHub</a></span>` : ''}
            <span>Segurança ${r.security?.reviewer ? who(r.security.reviewer) : '—'} <b>${r.security?.findings.length ? `${r.security.findings.length} falha(s) corrigida(s)` : 'sem falhas'}</b></span>
            ${r.cost ? `<span>Custo <b>${usd(r.cost)}</b></span>` : ''}
          </div>
          ${(r.security?.findings || []).map((f) => `<div class="finding" style="--s:${SEVERITY[f.severity] || '#facc15'}"><b>${esc(f.severity)}</b> ${esc(f.title)} <small>corrigida antes do merge</small></div>`).join('')}
        </article>`).join('') : '<p class="empty">Nenhuma task entregue ainda. O QA escreve o relatório quando aprova e faz o merge.</p>'),
    },
    canvas: {
      title: 'Canvas do projeto',
      html: () => {
        const c = feed.canvas;
        if (!c) return '<p class="empty">Nenhum canvas ligado ao escritório.</p>';
        const pending = feed.ideas.filter((i) => i.focus === 'canvas' && i.status === 'aguardando').length;
        const phases = Map.groupBy(c.screens, (sc) => sc.phaseName);
        return `
          <div class="canvas-head">
            <div><b>${esc(c.title)}</b><small>${c.screens.length} telas · snapshot ${esc(c.version || '')} de ${c.syncedAt.toLocaleDateString('pt-BR')}</small></div>
            ${pending ? `<button data-open="ideas">${pending} tela(s) aguardando sua aprovação</button>` : ''}
            <a class="open-canvas" href="${esc(c.url)}" target="_blank" rel="noopener">Abrir o canvas ↗</a>
          </div>
          <canvas class="canvas-map" width="1120" height="400"></canvas>
          <div class="ov-floor">O que o robô do canvas viu</div>
          <ul class="changes">${c.changes.slice(-10).reverse().map((ch) => `<li><time>${fmtTime(ch.ts)}</time>${esc(ch.text)}</li>`).join('') || '<li>Ainda não conferiu o canvas.</li>'}</ul>
          ${[...phases].map(([phase, list]) => `
            <div class="ov-floor">${esc(phase)}</div>
            ${[...Map.groupBy(list, (sc) => sc.section)].map(([section, items]) => `
              <h5 class="cv-section">${esc(section)}</h5>
              <div class="cv-screens">${items.map((sc) => {
                const st = screenState(sc);
                return `<span class="cv-screen" style="--c:${SCREEN[st].color}" title="${esc(SCREEN[st].label)}${sc.taskId ? ` · ${esc(sc.taskId)}` : ''}">${esc(sc.name)}</span>`;
              }).join('')}</div>`).join('')}`).join('')}`;
      },
    },
    ideas: {
      title: 'Aguardando sua aprovação',
      html: () => {
        if (!feed.ideas.length) return '<p class="empty">Nada esperando você ainda. Os robôs seguem analisando o SaaS.</p>';
        const pending = feed.ideas.filter((i) => i.status === 'aguardando').reverse();
        const decided = feed.ideas.filter((i) => i.status !== 'aguardando').reverse();
        const card = (i) => {
          const release = i.focus === 'release';
          const post = i.focus === 'post' && feed.marketing?.pieces.find((p) => p.id === i.piece);
          const approveLabel = release ? `✔ Aprovar e mandar para ${esc(OFFICE.productionBranch)}` : post ? '✔ Aprovar e agendar' : i.focus === 'divulgação' ? '✔ Aprovar a divulgação' : '✔ Aprovar e mandar para o board';
          return `
          <article class="idea ${i.status}${release ? ' release' : ''}${post ? ' post' : ''}" style="--a:${(FOCUS[i.focus] || FOCUS.dev).color}">
            <header><span class="tag">${(FOCUS[i.focus] || FOCUS.dev).label}</span><span class="status">${esc(i.status)}${i.taskId ? ` · ${esc(i.taskId)}${release ? '' : ' no board'}` : ''}</span></header>
            ${post ? `<div class="post-row" data-piece="${esc(post.id)}">${creative(post)}<div><h4>${esc(i.title)}</h4><pre class="caption">${esc(post.caption)}</pre><small>nota da agência ${post.score?.toFixed(1)} · ver roteiro, avaliação e linha do tempo →</small></div></div>` : `<h4>${esc(i.title)}</h4><p>${esc(i.detail)}</p>`}
            <footer>${who(i.by)} · ${fmtTime(i.ts)}</footer>
            ${i.status === 'aguardando' && feed.canDecide ? `<div class="decide"><button data-approve="${esc(i.id)}">${approveLabel}</button>${post ? `<button data-adjust="${esc(i.id)}" class="mid">✎ Pedir ajuste</button>` : ''}<button data-reject="${esc(i.id)}" class="no">${release ? 'Segurar' : 'Recusar'}</button></div>` : ''}
          </article>`;
        };
        return `<div class="ov-floor">Aguardando sua aprovação · ${pending.length}</div>
          ${feed.canDecide ? '' : '<p class="empty">A aprovação pelo escritório precisa do servidor do motor (npm run motor). Sem ele, o escritório só mostra.</p>'}
          ${pending.length ? `<div class="ideas">${pending.map(card).join('')}</div>` : '<p class="empty">Nada esperando você. Os robôs seguem analisando.</p>'}
          ${decided.length ? `<div class="ov-floor">Decididas</div><div class="ideas">${decided.slice(0, 30).map(card).join('')}</div>` : ''}`;
      },
    },
    releases: {
      title: 'Produção · releases, erros e changelog',
      html: () => {
        const waiting = feed.board.filter((t) => t.column === 'merged' && !t.released);
        const pendingRelease = feed.ideas.find((i) => i.focus === 'release' && i.status === 'aguardando');
        const last = feed.releases?.at(-1);
        return `
          <div class="prod-head">
            <div><small>Em produção (${esc(OFFICE.productionBranch)})</small><b>${last ? esc(last.version) : 'nenhum release ainda'}</b>${last ? `<small>${last.ts.toLocaleString('pt-BR')}</small>` : ''}</div>
            <div><small>Em ${esc(OFFICE.baseBranch)}, esperando release</small><b>${waiting.length} entrega(s)</b><small>${esc(waiting.slice(0, 4).map((t) => t.title).join(', '))}${waiting.length > 4 ? '…' : ''}</small></div>
            ${pendingRelease ? `<button data-open="ideas">${esc(pendingRelease.title)} espera você</button>` : `<p class="panel-hint">Os robôs só fazem merge em ${esc(OFFICE.baseBranch)}. O OPS_01 propõe o release a cada ${4} entregas, e ele só vai para ${esc(OFFICE.productionBranch)} com a sua aprovação.</p>`}
          </div>
          <div class="ov-floor">Erros em produção</div>
          ${(feed.incidents || []).length ? `<ul class="changes">${feed.incidents.slice().reverse().slice(0, 10).map((i) => `<li><time>${fmtTime(i.ts)}</time><b style="color:${SEVERITY[i.severity]}">${esc(i.severity)}</b> ${esc(i.error)} · ${i.count}× · ${esc(i.release || '')} · correção ${esc(i.taskId)}</li>`).join('')}</ul>` : '<p class="empty">Nenhum erro em produção.</p>'}
          <div class="ov-floor">Releases</div>
          ${(feed.releases || []).length ? feed.releases.slice().reverse().map((r) => `
            <article class="report" style="--a:#34d399">
              <header><b>${esc(r.version)}</b> ${r.tasks.length} entregas <time>${r.ts.toLocaleString('pt-BR')}</time></header>
              <p>${esc(r.notes)}</p>
              <button class="copy" data-copy="${esc(`PetLive ${r.version}\n${r.notes}`)}">Copiar notas para as lojas</button>
            </article>`).join('') : '<p class="empty">Nenhum release ainda.</p>'}
          <div class="ov-floor">CHANGELOG (DOCS_01)</div>
          ${(feed.changelog || []).length ? `<ul class="changes one">${feed.changelog.slice().reverse().slice(0, 20).map((c) => `<li><time>${fmtTime(c.ts)}</time>${esc(c.text)} <small>${esc(c.taskId)}</small></li>`).join('')}</ul>` : '<p class="empty">Nada documentado ainda.</p>'}`;
      },
    },
    today: {
      title: 'Resumo do dia',
      html: () => {
        const d = buildToday(feed);
        return `
          <div class="today-actions"><button class="copy" data-copy="${esc(d.text)}">Copiar para o WhatsApp</button></div>
          <pre class="today-text">${esc(d.text)}</pre>
          ${d.pending.length ? `<button data-open="ideas" class="today-cta">${d.pending.length} item(ns) esperando a sua decisão →</button>` : ''}
          ${(feed.insights || []).length ? `<div class="ov-floor">Uso das telas (DATA_01)</div><ul class="changes one">${feed.insights.slice().reverse().slice(0, 8).map((i) => `<li><time>${fmtTime(i.ts)}</time>${esc(i.text)}</li>`).join('')}</ul>` : ''}`;
      },
    },
    metrics: {
      title: 'Métricas do time',
      html: () => {
        const m = computeMetrics(feed);
        const pctTxt = (v) => `${Math.round(v * 100)}%`;
        const tiles = [
          ['Entregues', String(m.delivered)],
          ['Tempo médio por task', m.cycleAvg],
          ['Reprovação no QA', pctTxt(m.qaRejectRate)],
          ['Reprovação na segurança', pctTxt(m.secRejectRate)],
          ['Custo médio por task', usd(m.costPerTask)],
          ['Gasto hoje', `${usd(m.spendToday)} de ${usd(m.budget)}`],
        ];
        return `
          <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
          <div class="budget-row">
            <span>Orçamento do dia</span>
            <button data-budget="-5">− US$ 5</button><b>${usd(m.budget)}</b><button data-budget="5">+ US$ 5</button>
          </div>
          <canvas class="spend-chart" width="1120" height="260"></canvas>
          ${feed.remembers ? '<p class="panel-hint">A simulação guarda tudo neste navegador. <button class="link" data-reset>Recomeçar do zero</button></p>' : ''}
          <div class="ov-floor">Filas ${m.bottleneck ? `· gargalo: ${esc(m.bottleneck.label)}` : ''}</div>
          <div class="queues">${m.queues.map((q) => `<div class="queue${m.bottleneck?.id === q.id ? ' hot' : ''}"><small>${esc(q.label)}</small><b>${q.size}</b><i style="width:${Math.min(100, q.load * 25)}%"></i><small>${q.robots} robô(s)</small></div>`).join('')}</div>
          <div class="ov-floor">Gasto por robô</div>
          <table class="costs"><tbody>${m.perRobot.slice(0, 12).map((r) => `<tr><td>${who(r.id)}</td><td>${usd(r.cost)}</td><td>${r.done} ${esc(doneLabel(robotById(r.id)))}</td></tr>`).join('')}</tbody></table>`;
      },
    },
    account: {
      title: 'IA dos robôs',
      // a escolha do modelo e o e-mail ficam fora do trecho que redesenha, para não perder o que você digitou
      shell: () => `${live ? `
        <div class="ai-pick" data-ai-pick>
          <small>Modelo que os robôs usam</small>
          <button class="ai-current" data-ai-toggle aria-haspopup="listbox" aria-expanded="false"><i>▣</i><b data-ai-name>carregando…</b><span>⌄</span></button>
          <div class="ai-menu" data-ai-menu hidden>
            <label class="ai-search"><i>⌕</i><input data-ai-q autocomplete="off" spellcheck="false" placeholder="Buscar modelos" /></label>
            <div class="ai-list" data-ai-list role="listbox"></div>
            <button class="ai-foot" data-ai-refresh><i>⟳</i>Atualizar a lista de modelos</button>
          </div>
        </div>` : ''}<div data-body></div>${live ? `
        <div class="acc-form">
          <label>E-mail da conta Claude que os robôs vão usar<input data-acc-email type="email" autocomplete="email" placeholder="voce@exemplo.com" /></label>
          <button data-acc-login>Conectar conta Claude</button>
        </div>
        <p class="panel-hint">O navegador abre para você entrar e autorizar. Se ele já estiver logado em outra conta do claude.ai,
        use uma janela anônima ou outro perfil: a autorização vai para a conta que estiver logada.</p>` : ''}`,
      html: () => {
        if (!live) {
          return `<p class="panel-hint">Na simulação não há robôs de verdade, então não há conta. A conta Claude é usada pelo motor:
            rode <code>npm run motor</code> e abra o escritório com <code>?live=1</code>; este painel passa a conectar a conta.</p>`;
        }
        const a = account();
        if (!a) return '<p class="empty">Consultando o motor…</p>';
        if (a.error) return `<p class="empty">Não consegui falar com o motor: ${esc(a.error)}</p>`;
        const override = (a.using === 'apiKey' || a.using === 'token') && a.connected;
        const ai = a.ai;
        const onClaude = !ai || ai.provider === 'claude';
        return `
          ${ai ? `<div class="acc-now ai">
            <small>Os robôs estão usando</small>
            <b>${onClaude ? 'Claude' : 'OpenCode'} · ${esc(ai.model)}</b>
            <small>${onClaude
              ? 'Pela conta Claude abaixo. Se o plano acabar no meio, o robô espera a renovação e continua.'
              : 'Pelo OpenCode desta máquina, com as contas e chaves dele (opencode auth login). O gasto informado pelo provedor entra no orçamento do dia; o plano Claude não é usado.'}</small>
          </div>` : ''}
          <div class="ov-floor">Conta Claude${onClaude ? '' : ' (vale quando a IA for Claude)'}</div>
          <div class="acc-now ${esc(a.using)}">
            <small>${onClaude ? 'Os robôs estão usando' : 'Conta que os robôs usam com o Claude'}</small>
            <b>${esc(a.label)}</b>
            ${a.using === 'maquina' ? '<small>É a mesma conta do seu Claude Code: o uso dos robôs sai do seu limite. Conecte outra conta abaixo.</small>' : ''}
            ${override ? `<small>A conta ${esc(a.connected.email)} está conectada, mas a chave ou o token em motor/.env vence ela. Esvazie o .env para usá-la.</small>` : ''}
          </div>
          ${a.connected ? `<div class="acc-connected"><span>Conectada: <b>${esc(a.connected.email)}</b>${a.connected.plan ? ` · plano ${esc(a.connected.plan)}` : ''}</span><button data-acc-logout>Desconectar</button></div>` : ''}
          ${a.login?.waiting ? `<div class="acc-wait">Esperando você autorizar ${a.login.email ? `<b>${esc(a.login.email)}</b>` : 'a conta'} no navegador…
            ${a.login.url ? `<a href="${esc(a.login.url)}" target="_blank" rel="noopener">Abrir a página de login</a>` : ''}</div>
          ${a.login.needsCode ? `<div class="acc-code"><label>Depois de autorizar, a página mostra um código. Cole aqui:<input data-acc-code autocomplete="off" placeholder="código do navegador" /></label><button data-acc-send>Enviar código</button></div>` : ''}` : ''}
          ${a.login?.error ? `<p class="acc-error">${esc(a.login.error)}</p>` : ''}`;
      },
    },
    audit: {
      title: 'Histórico completo',
      // a busca fica fora do trecho que redesenha, senão perderia o foco a cada atualização
      shell: () => `<div class="audit-filter"><input data-audit-q placeholder="buscar: #123, WEB_01, release, aprovou…" /><select data-audit-kind><option value="">tudo</option><option>decisão</option><option>alerta</option><option>evento</option><option>sugestão</option><option>release</option><option>conversa</option></select></div><div data-body></div>`,
      html: () => {
        const q = (root().querySelector('[data-audit-q]')?.value || '').toLowerCase();
        const kind = root().querySelector('[data-audit-kind]')?.value || '';
        const rows = (feed.audit || []).filter((e) => (!kind || e.kind === kind) && (!q || `${e.actor} ${e.text} ${e.taskId || ''}`.toLowerCase().includes(q)));
        return `<p class="panel-hint">${rows.length} registro(s)${feed.audit?.length ? ` · desde ${fmtTime(feed.audit[0].ts)}` : ''}</p>
          <ul class="audit">${rows.slice(-300).reverse().map((e) => `<li class="k-${esc(e.kind)}"><time>${e.ts.toLocaleTimeString('pt-BR')}</time><span class="kind">${esc(e.kind)}</span><b>${e.actor === 'VOCÊ' ? 'VOCÊ' : who(e.actor)}</b> ${esc(e.text)}</li>`).join('')}</ul>`;
      },
    },
  };

  // linha do tempo de uma task: do board ao merge (e à produção), com cada passo por robô
  function taskHtml(id) {
    const t = feed.task(id);
    if (!t) return '<p class="empty">Essa task já saiu do board.</p>';
    return `
      <div class="task-head" style="--a:${AREA[t.area].color}">
        <b>${esc(t.id)} · ${esc(t.title)}</b>
        <small>${AREA[t.area].label} · ${esc(COLUMNS.find((c) => c.id === t.column)?.label || t.column)} · <code>${esc(t.branch)}</code>${t.cost ? ` · ${usd(t.cost)}` : ''}${t.released ? ` · ${esc(t.released)} em produção` : ''}${prLink(t.pr)}</small>
      </div>
      ${t.blocked && feed.unblock ? `<div class="task-blocked"><span>Task parada: ${t.rework > 1 ? `voltou ${t.rework} vezes` : 'um robô travou'}. Veja a linha do tempo e destrave quando quiser que siga.</span><button data-unblock="${esc(t.id)}">Destravar e tentar de novo</button></div>` : ''}
      <ol class="timeline">${(t.timeline || []).map((e) => `<li><time>${fmtTime(new Date(e.ts))}</time><b>${e.robotId === 'VOCÊ' ? 'VOCÊ' : who(e.robotId)}</b> ${esc(e.text)}</li>`).join('')}</ol>
      ${t.commits?.length ? `<div class="ov-floor">Commits</div><ul class="changes one">${t.commits.map((c) => `<li><code>${esc(c.sha.slice(0, 7))}</code> ${esc(c.message)}</li>`).join('')}</ul>` : ''}`;
  }
  return { PANELS, taskHtml, pieceHtml };
}
