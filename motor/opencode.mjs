// Agentes pelo OpenCode (`opencode run`), para usar qualquer modelo que ele tenha (`opencode models`):
// os gratuitos do próprio OpenCode, os do OpenRouter, ou outro provedor conectado com `opencode auth login`.
// Cada papel vira um agente do OpenCode com as mesmas travas do Claude: só o dev edita arquivos, ninguém
// faz commit, push ou merge (isso é do orquestrador) e quem não tem terminal no Claude também não tem aqui.
import { spawn, execFile } from 'node:child_process';

const BIN = process.env.OPENCODE_BIN || 'opencode';
const agentName = (role) => `petlive-${role}`;
// 'Bash(git push:*)' → 'git push*' (o formato de padrões do OpenCode)
const bashPattern = (rule) => rule.match(/^Bash\((.+?)(?::\*)?\)$/)?.[1];

// a configuração vai pelo ambiente (OPENCODE_CONFIG_CONTENT) e se soma à do OpenCode desta máquina
function configFor(roles, suffix) {
  const agent = {};
  for (const [role, cfg] of Object.entries(roles)) {
    const edits = cfg.tools.includes('Edit') || cfg.tools.includes('Write');
    const bash = cfg.tools.includes('Bash')
      ? { '*': 'allow', ...Object.fromEntries(cfg.deny.map(bashPattern).filter(Boolean).map((p) => [`${p}*`, 'deny'])) }
      : 'deny';
    agent[agentName(role)] = {
      mode: 'primary',
      prompt: `${cfg.prompt}\n${suffix}`,
      steps: cfg.maxTurns,
      permission: { edit: edits ? 'allow' : 'deny', bash, webfetch: 'deny' },
    };
  }
  return JSON.stringify({ agent });
}

export function createOpenCode({ roles, suffix, log }) {
  const CONFIG = configFor(roles, suffix);
  let models = null;

  // roda o agente do papel até o fim; mesmo formato de resposta do agente Claude
  function run(role, { prompt, cwd, model, signal }) {
    return new Promise((resolve, reject) => {
      const args = ['run', '--format', 'json', '--auto', '--agent', agentName(role), '-m', model];
      if (cwd) args.push('--dir', cwd);
      const child = spawn(BIN, args, { cwd: cwd || undefined, env: { ...process.env, OPENCODE_CONFIG_CONTENT: CONFIG }, windowsHide: true });
      // texto por mensagem: a resposta é a última mensagem com texto (as anteriores são o agente pensando alto)
      const texts = new Map();
      let cost = 0;
      let turns = 0;
      let error = null;
      let buf = '';
      let stderr = '';
      const onLine = (line) => {
        if (!line.trim()) return;
        let e;
        try { e = JSON.parse(line); } catch { return; }
        if (e.type === 'text' && e.part?.text) {
          const msg = texts.get(e.part.messageID) || new Map();
          msg.set(e.part.id, e.part.text);
          texts.delete(e.part.messageID);
          texts.set(e.part.messageID, msg);
        }
        if (e.type === 'step_finish') { cost += Number(e.part?.cost) || 0; turns++; }
        if (e.type === 'error') error = e.error?.data?.message || e.error?.name || 'erro do OpenCode';
      };
      child.stdout.on('data', (c) => {
        buf += c;
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(onLine);
      });
      child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
      const stop = () => child.kill();
      signal?.addEventListener('abort', stop);
      const timer = setTimeout(() => { error = 'passou de 60 minutos'; child.kill(); }, 60 * 60e3);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err.code === 'ENOENT' ? 'OpenCode não encontrado (instale e confira com `opencode --version`)' : err.message));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        onLine(buf);
        const last = [...texts.values()].pop();
        const text = last ? [...last.values()].join('\n').trim() : '';
        const ok = code === 0 && !error && !!text;
        if (!ok) log(`${role} (OpenCode ${model}): ${error || (text ? `saiu com código ${code}` : 'terminou sem resposta')}${stderr.trim() ? ` · ${stderr.trim().split('\n').pop()}` : ''}`);
        resolve({ text: ok ? text : '', cost, ok, turns, subtype: ok ? 'success' : error ? `erro: ${error}` : 'sem resposta' });
      });
      child.stdin.end(prompt);
    });
  }

  // modelos que o OpenCode tem agora (provedor/modelo); guarda por 10 minutos
  function list({ refresh = false } = {}) {
    if (models && !refresh && Date.now() - models.at < 10 * 60e3) return Promise.resolve(models.list);
    return new Promise((resolve, reject) => {
      execFile(BIN, ['models'], { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error(err.code === 'ENOENT' ? 'OpenCode não encontrado nesta máquina' : err.message));
        const list = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[\w.-]+\/\S+$/.test(l));
        models = { at: Date.now(), list };
        resolve(list);
      });
    });
  }

  return { run, list };
}
