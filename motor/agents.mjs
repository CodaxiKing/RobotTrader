// Os agentes do escritório, rodando com o Claude Agent SDK (o harness do Claude Code como biblioteca)
// ou com o OpenCode (motor/opencode.mjs), conforme a IA escolhida no escritório.
// Cada papel tem as suas ferramentas: só o dev edita arquivos; segurança e QA leem e rodam comandos.
// Commit, push e merge ficam com o orquestrador, nunca com o agente.
import { query, USAGE_LIMIT_ERROR_PREFIXES } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createOpenCode } from './opencode.mjs';

// No Windows o Claude Code só oferece o Bash quando acha o Git Bash; sem ele sobra a PowerShell, que quebra
// aqui ("Linha de comando muito longa") e os agentes ficam sem terminal. Instalação por usuário
// (AppData\Local\Programs\Git) fica fora de onde ele procura, então o caminho sai do git.exe do PATH.
export function findGitBash() {
  if (process.platform !== 'win32') return null;
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const roots = [
    ...dirs.filter((d) => existsSync(path.join(d, 'git.exe'))).flatMap((d) => [path.resolve(d, '..'), path.resolve(d, '..', '..')]),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git'),
  ];
  const bash = roots.map((r) => path.join(r, 'bin', 'bash.exe')).find((f) => existsSync(f)) || null;
  if (bash) process.env.CLAUDE_CODE_GIT_BASH_PATH = bash;
  return bash;
}
export const GIT_BASH = findGitBash();

// modelos Claude que o escritório oferece (o motor/config.json pode usar outro)
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
].map((m) => ({ ...m, provider: 'claude', providerName: 'Claude · sua conta', free: false, plan: true }));
const PT_BR = 'Responda sempre em português do Brasil, inclusive nos textos dentro do JSON.';

// o limite do plano (5h ou semanal) acabou no meio do trabalho; resetsAt é quando renova (ms, ou null se não veio)
export class PlanLimitError extends Error {
  constructor(resetsAt, detail) {
    super(`limite do plano acabou${detail ? ` (${detail})` : ''}`);
    this.planLimit = true;
    this.resetsAt = resetsAt;
  }
}
const toMs = (v) => (v == null ? null : typeof v === 'string' ? Date.parse(v) || null : v < 1e12 ? v * 1000 : v);
const isLimitText = (text) => USAGE_LIMIT_ERROR_PREFIXES.some((p) => String(text || '').trim().startsWith(p));

// o agente não mexe no histórico do git nem apaga às cegas; isso é do orquestrador
const NO_GIT_WRITES = ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git checkout:*)', 'Bash(git reset:*)', 'Bash(git commit:*)', 'Bash(git rebase:*)', 'Bash(rm -rf:*)'];

const ROLES = {
  po: {
    tools: ['Read', 'Glob', 'Grep'],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 12,
    prompt: `Você é o Product Owner do PetLive, um SaaS para tutores de pets (app em React Native) e para lojistas e admin (web em Next.js).
Transforme a task em critérios de aceite claros e testáveis, olhando o código quando ajudar.
Responda só com os critérios, em português, numa lista curta. Nada de código.`,
  },
  dev: {
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    deny: NO_GIT_WRITES,
    maxTurns: 80,
    prompt: `Você é dev do PetLive (monorepo pnpm: apps/tutor em Expo/React Native, apps/web em Next.js, supabase/ no backend).
Implemente a task seguindo o padrão do código que já existe: leia antes o AGENTS.md da app que vai mexer (apps/tutor/AGENTS.md,
apps/web/AGENTS.md), o README, o BUSINESS.md e os arquivos vizinhos. Escreva ou ajuste os testes.
Rode o lint e os testes do projeto antes de terminar. Não faça commit, push nem merge: o escritório faz isso.
No fim, responda com um resumo curto do que mudou.`,
  },
  sec: {
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    deny: ['Edit', 'Write', ...NO_GIT_WRITES],
    maxTurns: 40,
    prompt: `Você é o revisor de segurança (AppSec) do PetLive. Revise só o que a branch mudou em relação à base.
Procure: injeção (SQL, comando), XSS, IDOR e checagem de dono do recurso, autenticação e permissão nas rotas,
segredos no código ou em variáveis públicas, upload sem validação, token guardado sem criptografia no app,
deep links sem validação e dependências com CVE conhecida. Não aponte estilo nem hipóteses sem evidência no diff.
Responda SOMENTE com JSON: {"ok": boolean, "findings": [{"severity": "alta"|"média"|"baixa", "title": string, "fix": string, "file": string}]}.
"ok" é true quando não há falha alta nem média.`,
  },
  qa: {
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    deny: ['Edit', 'Write', ...NO_GIT_WRITES],
    maxTurns: 50,
    prompt: `Você é o QA do PetLive (monorepo pnpm; leia o AGENTS.md da app). Instale as dependências se faltarem (pnpm install), rode os testes do projeto e confira cada critério
de aceite da task no código e, quando der, rodando o app ou os testes de tela. Não corrija nada: só avalie.
Responda SOMENTE com JSON: {"ok": boolean, "total": number, "passed": number, "failed": number, "summary": string, "problems": [string]}.`,
  },
  chat: {
    tools: [],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 2,
    prompt: 'Você é um robô do escritório do PetLive conversando com o dono. Responda em português, em até três frases, usando o contexto dado.',
  },
  docs: {
    tools: [],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 2,
    prompt: `Você escreve as notas de versão do PetLive para a App Store e o Google Play: em português, para o tutor
de pet (não para dev), no máximo 4 linhas, começando pelo que é novo. Responda só com o texto das notas.`,
  },
  idea: {
    tools: ['Read', 'Glob', 'Grep'],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 30,
    prompt: `Você analisa o código do PetLive procurando UMA melhoria concreta, com evidência no código, dentro do foco pedido.
Nada genérico. Não repita nada da lista do que já foi sugerido ou está no board, nem com outras palavras, e confira no
código que a melhoria ainda não foi feita. Responda SOMENTE com JSON: {"title": string curto, "detail": string com o porquê
e onde (arquivo), "area": "web"|"app"}; se não achar nada novo que valha a pena, responda {"none": true}.`,
  },
  screenCheck: {
    tools: ['Read', 'Glob', 'Grep'],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 15,
    prompt: `Você confere se uma tela do canvas de design do PetLive já existe no código: procure a rota, a tela ou o
componente pelo nome e pelo assunto (em português e em inglês). Só conta como implementada se a tela existe e funciona,
não um esboço vazio. Responda SOMENTE com JSON: {"implemented": boolean, "evidence": string com o arquivo, ou ""}.`,
  },
  existsCheck: {
    tools: ['Read', 'Glob', 'Grep'],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 20,
    prompt: `Você confere se a funcionalidade pedida por uma task do board já está implementada no PetLive (monorepo:
apps/tutor em Expo/React Native, apps/web em Next.js, supabase/ no backend). Procure a rota, a tela, o componente, o
serviço ou o endpoint pelo nome e pelo assunto, em português e em inglês. Só conta como implementada se a funcionalidade
existe e funciona de verdade, não um esboço vazio nem uma tela sem a lógica por trás. Responda SOMENTE com JSON:
{"implemented": boolean, "evidence": string com o arquivo (ou arquivos) que prova, ou ""}.`,
  },
  script: {
    tools: [],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 2,
    prompt: `Você é roteirista de vídeos curtos (Reels, TikTok, Shorts) do PetLive, app para tutores de pets.
Gancho nos 3 primeiros segundos, uma ideia só, CTA claro no fim, até 25 s.
Responda SOMENTE com JSON: {"script": [{"t": "0-3s", "scene": string, "line": string}]}.`,
  },
  copy: {
    tools: [],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 2,
    prompt: `Você é copywriter das redes do PetLive, app para tutores de pets. Tom próximo e claro, sem exagero.
Responda SOMENTE com JSON: {"hook": string, "caption": string (gancho, 2-3 frases e o CTA), "hashtags": [string, até 5],
"photo": string (busca em inglês para um banco de imagens: o pet e a cena da foto de fundo, 2 a 5 palavras, sem texto nem logo)}.`,
  },
  critic: {
    tools: [],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 2,
    prompt: `Você avalia criativos de redes sociais do PetLive com rigor. Dê nota de 0 a 10 em gancho, clareza, marca, cta e formato
(texto pequeno no celular, duração). Responda SOMENTE com JSON:
{"scores": {"gancho": n, "clareza": n, "marca": n, "cta": n, "formato": n}, "feedback": string com o ajuste mais importante}.`,
  },
};

// tira o primeiro objeto JSON da resposta (o agente às vezes envolve em ```json)
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('o agente não devolveu JSON');
  return JSON.parse(text.slice(start, end + 1));
}

// ai(): a IA escolhida agora, { provider: 'claude' | 'opencode', model }; muda sem reiniciar o motor
export function createAgents({ model, budgets, dryRun, log, onRateLimit, ai = () => ({ provider: 'claude', model }) }) {
  const opencode = createOpenCode({ roles: ROLES, suffix: PT_BR, log });
  // ensaio rápido para os testes (MOTOR_DRY_FAST=1): sem espera e com custo fixo
  const dryFast = () => process.env.MOTOR_DRY_FAST === '1';
  // testes podem forçar o ensaio em vez de depender do sorte: MOTOR_DRY_EXISTS=1|0, MOTOR_DRY_FAIL=1|0
  const envBool = (k) => (process.env[k] == null ? null : process.env[k] === '1');
  // ensaio: um plano de mentira que enche 3% por agente e renova 20 s depois de acabar, para ver a espera
  const fake = { used: 70, resetsAt: Date.now() + 10 * 60e3 };
  function fakeSpend() {
    if (dryFast()) { fake.used = (fake.used + 3) % 60; return; }
    if (Date.now() > fake.resetsAt) Object.assign(fake, { used: 0, resetsAt: Date.now() + 10 * 60e3 });
    if (fake.used >= 100) throw new PlanLimitError(fake.resetsAt, 'ensaio');
    fake.used = Math.min(100, fake.used + 3);
    if (fake.used >= 100) fake.resetsAt = Date.now() + 20e3;
  }

  // roda um agente até o fim e devolve { text, cost, ok, turns }
  async function run(role, { prompt, cwd, budget, signal }) {
    const cfg = ROLES[role];
    const chosen = ai();
    if (dryRun) { if (chosen.provider === 'claude') fakeSpend(); return dryRunAnswer(role, prompt); }
    if (chosen.provider === 'opencode') return opencode.run(role, { prompt, cwd, model: chosen.model, signal });
    // erro transitório (API oscilando, rede): uma tentativa nova antes de travar a task; o limite
    // do plano nunca entra aqui (é PlanLimitError, que estaciona a task e espera renovar)
    const TRANSIENT = /overloaded|rate.?limit|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|529|503|502/i;
    for (let attempt = 0; ; attempt++) {
      try { return await claudeOnce(role, { prompt, cwd, cfg, chosen, budget, signal }); }
      catch (err) {
        if (err.planLimit || attempt || !TRANSIENT.test(`${err.message} ${err.subtype || ''}`)) throw err;
        log(`${role}: falhou (${err.message.slice(0, 120)}) · tentando de novo em 10 s`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }
  async function claudeOnce(role, { prompt, cwd, cfg, chosen, budget, signal }) {
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort());
    let result = null;
    // o Claude Code avisa a cada mudança do limite do plano; "rejected" é o limite que acabou
    let rejectedAt;
    let limitHit = false;
    const stream = query({
      prompt,
      options: {
        cwd,
        model: chosen.model || model,
        allowedTools: cfg.tools,
        // terminal só pelo Bash (Git Bash no Windows): a ferramenta PowerShell quebra aqui ("Linha de comando muito
        // longa") e passaria por fora das travas de git acima, que são regras de Bash
        disallowedTools: [...cfg.deny, 'PowerShell'],
        permissionMode: role === 'dev' ? 'acceptEdits' : 'default',
        // o escritório e os relatórios são em português; sem isto os agentes respondem em inglês
        systemPrompt: { type: 'preset', preset: 'claude_code', append: `${cfg.prompt}
${PT_BR}` },
        // carrega o CLAUDE.md e as configurações do próprio repositório do PetLive
        settingSources: ['project'],
        maxTurns: cfg.maxTurns,
        maxBudgetUsd: budget ?? budgets[role] ?? budgets.default,
        abortController: controller,
      },
    });
    try {
      for await (const message of stream) {
        if (message.type === 'result') result = message;
        if (message.type === 'rate_limit_event') {
          const info = message.rate_limit_info;
          onRateLimit?.(info);
          if (info.status === 'rejected') rejectedAt = toMs(info.resetsAt);
        }
        if (message.type === 'assistant' && message.error === 'rate_limit') limitHit = true;
      }
    } catch (err) {
      if (isLimitText(err.message) || rejectedAt !== undefined) throw new PlanLimitError(rejectedAt ?? null, err.message);
      throw err;
    }
    const ok = result && result.subtype === 'success' && !result.is_error;
    if (!ok && (limitHit || rejectedAt !== undefined || isLimitText(result?.result))) {
      throw new PlanLimitError(rejectedAt ?? null, String(result?.result || '').slice(0, 120));
    }
    if (!result) throw new Error(`${role}: o agente terminou sem resultado`);
    if (!ok) log(`${role}: ${result.subtype}${result.errors?.length ? ` · ${result.errors.join('; ')}` : ''}`);
    return { text: ok ? result.result : '', cost: result.total_cost_usd || 0, ok, turns: result.num_turns, subtype: result.subtype };
  }

  // ensaio: respostas plausíveis, sem chamar a API; o texto do post sai da pauta, para cada peça ter o seu
  const DRY_IDEAS = [
    ['Cache da lista de pets', 'A tela de pets refaz a busca a cada navegação.', 'app'],
    ['Esqueleto de carregamento no Início', 'O Início fica em branco até a API responder.', 'app'],
    ['Mensagem de erro amigável no login', 'O login mostra o erro cru da API.', 'web'],
    ['Rótulos de leitor de tela nos atalhos', 'Os ícones de Todos os atalhos não têm accessibilityLabel.', 'app'],
    ['Imagens do pet em WebP', 'As fotos dos pets vão em PNG cheio.', 'web'],
  ].map(([title, detail, area]) => ({ title: `${title} (ensaio)`, detail: `${detail} (ensaio)`, area }));
  function dryCopy(prompt) {
    const [, hook = 'Novidade no PetLive', body = '', cta = 'Baixe o PetLive.'] = prompt.match(/Gancho: (.+)\nTexto: (.*)\nCTA: (.+)/) || [];
    return { hook, body, cta, caption: `${hook}\n\n${body}\n\n👉 ${cta}`, hashtags: ['#petlive', '#pets', '#tutordepet'] };
  }
  async function dryRunAnswer(role, prompt = '') {
    await new Promise((r) => setTimeout(r, dryFast() ? 0 : 1500 + Math.random() * 2500));
    const cost = dryFast() ? 0.01 : 0.01 + Math.random() * 0.03;
    const exists = envBool('MOTOR_DRY_EXISTS');
    const fail = envBool('MOTOR_DRY_FAIL');
    const answers = {
      po: '- A tela segue o artboard do canvas\n- Campos obrigatórios validados\n- Estado vazio e de erro tratados',
      dev: 'Implementei a tela, os testes e ajustei o lint (ensaio).',
      sec: JSON.stringify(fail == null
        ? (Math.random() < 0.25
          ? { ok: false, findings: [{ severity: 'média', title: 'Rota sem checagem de permissão (ensaio)', fix: 'Exigir o papel certo no middleware.', file: 'src/api/route.ts' }] }
          : { ok: true, findings: [] })
        : (fail
          ? { ok: false, findings: [{ severity: 'média', title: 'Rota sem checagem de permissão (ensaio)', fix: 'Exigir o papel certo no middleware.', file: 'src/api/route.ts' }] }
          : { ok: true, findings: [] })),
      qa: JSON.stringify(fail == null
        ? (Math.random() < 0.2
          ? { ok: false, total: 30, passed: 28, failed: 2, summary: 'Dois testes falharam (ensaio).', problems: ['validação do formulário'] }
          : { ok: true, total: 30, passed: 30, failed: 0, summary: 'Todos os testes passaram (ensaio).', problems: [] })
        : (fail
          ? { ok: false, total: 30, passed: 28, failed: 2, summary: 'Dois testes falharam (ensaio).', problems: ['validação do formulário'] }
          : { ok: true, total: 30, passed: 30, failed: 0, summary: 'Todos os testes passaram (ensaio).', problems: [] })),
      chat: 'Estou em modo de ensaio: o motor não está chamando a API agora.',
      docs: 'Novidades: lembretes de vacina e cadastro do pet mais rápido. Correções de estabilidade.',
      // a próxima ideia de exemplo que ainda não está na lista do que já foi sugerido; acabou a lista, nada novo
      idea: JSON.stringify(DRY_IDEAS.find((i) => !prompt.includes(i.title)) || { none: true }),
      screenCheck: JSON.stringify(Math.random() < 0.3 ? { implemented: true, evidence: 'app/(tabs)/tela.tsx (ensaio)' } : { implemented: false, evidence: '' }),
      existsCheck: JSON.stringify(exists == null
        ? (Math.random() < 0.2 ? { implemented: true, evidence: 'apps/web/app/rota/page.tsx (ensaio)' } : { implemented: false, evidence: '' })
        : { implemented: exists, evidence: exists ? 'apps/web/app/rota/page.tsx (ensaio forçado)' : '' }),
      script: JSON.stringify((({ hook, body, cta }) => ({ script: [{ t: '0-3s', scene: 'Close no pet', line: hook }, { t: '3-15s', scene: 'Print do app', line: body.split('. ')[0] }, { t: '15-25s', scene: 'Logo PetLive', line: cta }] }))(dryCopy(prompt))),
      copy: JSON.stringify(dryCopy(prompt)),
      critic: JSON.stringify({ scores: { gancho: 8, clareza: 8, marca: 7, cta: 8, formato: 8 }, feedback: 'Aumentar o logo no fim (ensaio).' }),
    };
    return { text: answers[role], cost, ok: true, turns: 1, subtype: 'success' };
  }

  // uso do plano da conta (o mesmo do /usage): abre uma sessão sem mandar mensagem, então não gasta nada.
  // null quando não há plano (chave de API) ou o Claude Code não respondeu
  async function usage() {
    if (ai().provider !== 'claude') return null;
    if (dryRun) {
      if (Date.now() > fake.resetsAt) Object.assign(fake, { used: 0, resetsAt: Date.now() + 10 * 60e3 });
      return { available: true, name: 'ensaio', session: { ...fake }, weekly: { used: 40, resetsAt: Date.now() + 3 * 864e5 } };
    }
    let release;
    const idle = (async function* () { await new Promise((r) => (release = r)); })();
    const q = query({ prompt: idle, options: { settingSources: [] } });
    try {
      const u = await Promise.race([
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('o Claude Code não respondeu o uso do plano')), 30000)),
      ]);
      if (!u.rate_limits_available || !u.rate_limits) return { available: false, name: u.subscription_type };
      const win = (w) => (w && w.utilization != null ? { used: w.utilization, resetsAt: toMs(w.resets_at) } : null);
      return { available: true, name: u.subscription_type, session: win(u.rate_limits.five_hour), weekly: win(u.rate_limits.seven_day) };
    } finally {
      release?.();
      q.close();
    }
  }

  return { run, usage, opencodeModels: (opts) => opencode.list(opts) };
}
