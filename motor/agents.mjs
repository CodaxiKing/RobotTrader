// Os agentes do escritório, rodando com o Claude Agent SDK (o harness do Claude Code como biblioteca).
// Cada papel tem as suas ferramentas: só o dev edita arquivos; segurança e QA leem e rodam comandos.
// Commit, push e merge ficam com o orquestrador, nunca com o agente.
import { query } from '@anthropic-ai/claude-agent-sdk';

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
    prompt: `Você é dev do PetLive. Implemente a task neste repositório seguindo o padrão do código que já existe
(leia o CLAUDE.md / README e os arquivos vizinhos antes de escrever). Escreva ou ajuste os testes.
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
    prompt: `Você é o QA do PetLive. Instale as dependências se faltarem, rode os testes do projeto e confira cada critério
de aceite da task no código e, quando der, rodando o app ou os testes de tela. Não corrija nada: só avalie.
Responda SOMENTE com JSON: {"ok": boolean, "total": number, "passed": number, "failed": number, "summary": string, "problems": [string]}.`,
  },
  chat: {
    tools: [],
    deny: ['Edit', 'Write', 'Bash'],
    maxTurns: 2,
    prompt: 'Você é um robô do escritório do PetLive conversando com o dono. Responda em português, em até três frases, usando o contexto dado.',
  },
};

// tira o primeiro objeto JSON da resposta (o agente às vezes envolve em ```json)
export function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('o agente não devolveu JSON');
  return JSON.parse(text.slice(start, end + 1));
}

export function createAgents({ model, budgets, dryRun, log }) {
  // roda um agente até o fim e devolve { text, cost, ok, turns }
  async function run(role, { prompt, cwd, budget, signal }) {
    const cfg = ROLES[role];
    if (dryRun) return dryRunAnswer(role);
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort());
    let result = null;
    for await (const message of query({
      prompt,
      options: {
        cwd,
        model,
        allowedTools: cfg.tools,
        disallowedTools: cfg.deny,
        permissionMode: role === 'dev' ? 'acceptEdits' : 'default',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: cfg.prompt },
        // carrega o CLAUDE.md e as configurações do próprio repositório do PetLive
        settingSources: ['project'],
        maxTurns: cfg.maxTurns,
        maxBudgetUsd: budget ?? budgets[role] ?? budgets.default,
        abortController: controller,
      },
    })) {
      if (message.type === 'result') result = message;
    }
    if (!result) throw new Error(`${role}: o agente terminou sem resultado`);
    const ok = result.subtype === 'success' && !result.is_error;
    if (!ok) log(`${role}: ${result.subtype}${result.errors?.length ? ` · ${result.errors.join('; ')}` : ''}`);
    return { text: ok ? result.result : '', cost: result.total_cost_usd || 0, ok, turns: result.num_turns, subtype: result.subtype };
  }

  // ensaio: respostas plausíveis, sem chamar a API
  async function dryRunAnswer(role) {
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
    const cost = 0.01 + Math.random() * 0.03;
    const answers = {
      po: '- A tela segue o artboard do canvas\n- Campos obrigatórios validados\n- Estado vazio e de erro tratados',
      dev: 'Implementei a tela, os testes e ajustei o lint (ensaio).',
      sec: JSON.stringify(Math.random() < 0.25
        ? { ok: false, findings: [{ severity: 'média', title: 'Rota sem checagem de permissão (ensaio)', fix: 'Exigir o papel certo no middleware.', file: 'src/api/route.ts' }] }
        : { ok: true, findings: [] }),
      qa: JSON.stringify(Math.random() < 0.2
        ? { ok: false, total: 30, passed: 28, failed: 2, summary: 'Dois testes falharam (ensaio).', problems: ['validação do formulário'] }
        : { ok: true, total: 30, passed: 30, failed: 0, summary: 'Todos os testes passaram (ensaio).', problems: [] }),
      chat: 'Estou em modo de ensaio: o motor não está chamando a API agora.',
    };
    return { text: answers[role], cost, ok: true, turns: 1, subtype: 'success' };
  }

  return { run };
}
