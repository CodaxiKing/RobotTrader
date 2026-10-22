// Conta Claude dos robôs, separada do login do Claude Code desta máquina.
// O login fica em motor/conta-claude (CLAUDE_CONFIG_DIR, o jeito documentado de ter várias contas);
// o escritório tem o botão "Conectar conta Claude", que roda `claude auth login` nessa pasta.
// Precedência do Claude Code: ANTHROPIC_API_KEY > CLAUDE_CODE_OAUTH_TOKEN > login da pasta de configuração.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./conta-claude', import.meta.url));
// o Claude Code que vem com o Agent SDK, para a plataforma desta máquina
const EXE = fileURLToPath(new URL(`../node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const ENV = () => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: DIR };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
};

const run = (args) => new Promise((resolve) => {
  execFile(EXE, args, { env: ENV(), windowsHide: true, timeout: 30000 }, (err, stdout) => resolve(err ? null : stdout));
});

export function createAccount({ log }) {
  let login = null; // { email, url, startedAt, error, done }
  let child = null;

  async function dirStatus() {
    if (!existsSync(DIR)) return { loggedIn: false };
    try { return JSON.parse(await run(['auth', 'status', '--json']) || '{}'); } catch { return { loggedIn: false }; }
  }

  // aponta os próximos agentes para a conta da pasta (cada query do SDK lê o ambiente quando começa)
  function apply(st) {
    if (st.loggedIn) process.env.CLAUDE_CONFIG_DIR = DIR;
    else delete process.env.CLAUDE_CONFIG_DIR;
  }

  async function status() {
    const key = process.env.ANTHROPIC_API_KEY;
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const st = await dirStatus();
    apply(st);
    const using = key ? 'apiKey' : token ? 'token' : st.loggedIn ? 'conta' : 'maquina';
    return {
      using,
      // o que os robôs usam agora, em palavras
      label: {
        apiKey: `Chave de API …${key?.slice(-4)} (cobrança por uso)`,
        token: `Token de assinatura …${token?.slice(-4)} (motor/.env)`,
        conta: `${st.email} · ${st.subscriptionType ? `plano ${st.subscriptionType}` : st.authMethod}`,
        maquina: 'Login do Claude Code desta máquina (divide o limite com você)',
      }[using],
      email: using === 'conta' ? st.email : null,
      plan: using === 'conta' ? st.subscriptionType : null,
      // a conta da pasta fica conectada mesmo quando uma chave ou token no .env vence ela
      connected: st.loggedIn ? { email: st.email, plan: st.subscriptionType } : null,
      // sem terminal, o Claude Code usa o fluxo em que o navegador mostra um código para colar
      login: login && { email: login.email, url: login.url, error: login.error, waiting: !login.done, needsCode: !!login.url && /code=true/.test(login.url) },
    };
  }

  // abre o navegador para autorizar a conta; o processo termina sozinho quando o login conclui
  function startLogin(email) {
    if (login && !login.done) return;
    if (!existsSync(EXE)) throw new Error('Claude Code do Agent SDK não encontrado (rode npm install)');
    mkdirSync(DIR, { recursive: true });
    login = { email, url: null, error: null, done: false, startedAt: Date.now() };
    const args = ['auth', 'login', '--claudeai', ...(email ? ['--email', email] : [])];
    child = spawn(EXE, args, { env: ENV(), windowsHide: true });
    const read = (buf) => {
      const text = String(buf);
      const url = text.match(/https:\/\/\S+/)?.[0];
      if (url && !login.url) login.url = url;
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const timer = setTimeout(() => { child.kill(); login.error = 'O login não foi concluído em 5 minutos'; }, 5 * 60 * 1000);
    child.on('exit', async (code) => {
      clearTimeout(timer);
      login.done = true;
      const st = await dirStatus();
      apply(st);
      if (st.loggedIn) log(`Conta Claude dos robôs conectada: ${st.email} (${st.subscriptionType || st.authMethod})`);
      else if (!login.error) login.error = `O login terminou sem conectar (código ${code})`;
    });
  }

  // o código que o navegador mostrou depois de autorizar vai para o login que está esperando
  function submitCode(code) {
    if (!child || login?.done) throw new Error('Nenhum login esperando código; clique em Conectar de novo');
    child.stdin.write(`${String(code).trim()}
`);
  }

  async function logout() {
    if (existsSync(DIR)) await run(['auth', 'logout']);
    login = null;
    apply({ loggedIn: false });
    log('Conta Claude dos robôs desconectada; voltam ao login desta máquina');
  }

  return { status, startLogin, submitCode, logout };
}
