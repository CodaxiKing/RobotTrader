// Git e GitHub para o motor. Os robôs nunca mexem no checkout do dono: cada task tem o seu
// worktree, e o merge acontece num worktree de integração. Em dry-run, só registra o comando.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// erro transitório (rate limit, rede, GitHub fora do ar): vale uma tentativa antes de travar a task
const TRANSIENT = /rate limit|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|Could not resolve host|Connection reset|Connection refused|timed out|429|502|503|504/i;
export function createGit({ dryRun, log }) {
  async function run(cmd, args, { cwd } = {}) {
    if (dryRun) {
      log(`(dry-run) ${cmd} ${args.join(' ')}${cwd ? `  [${cwd}]` : ''}`);
      return '';
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (err) reject(new Error(`${cmd} ${args.join(' ')}: ${(stderr || err.message).trim()}`));
            else resolve(stdout.trim());
          });
        });
      } catch (err) {
        if (attempt || !TRANSIENT.test(err.message)) throw err;
        log(`${cmd} deu ruim de vez (${err.message.slice(0, 120)}) · tentando de novo em 5 s`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  const git = (cwd, ...args) => run('git', args, { cwd });
  // repo.worktrees escolhe a pasta (caminho curto ajuda no Windows); senão, <repo>-worktrees ao lado
  const worktreesOf = (repo) => repo.worktrees || `${repo.path.replace(/[\\/]+$/, '')}-worktrees`;
  // web e app no mesmo repositório dividem o worktree de integração: um merge (ou changelog) por vez
  const locks = new Map();
  const serial = (key, fn) => {
    const prev = locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(key, next);
    return next;
  };

  return {
    run,
    worktreesOf,
    // worktree da task, criado a partir da base mais recente (ou reaproveitado numa correção)
    async taskWorktree(repo, branch, base) {
      const dir = path.join(worktreesOf(repo), branch.replace(/[^\w.-]+/g, '_'));
      if (!dryRun && existsSync(dir)) return dir;
      if (!dryRun) mkdirSync(worktreesOf(repo), { recursive: true });
      await git(repo.path, 'fetch', 'origin', base);
      await git(repo.path, 'worktree', 'add', '-B', branch, dir, `origin/${base}`);
      return dir;
    },
    // commit do que o agente mudou e push da branch; devolve os commits novos
    async commitAndPush(dir, branch, base, message) {
      await git(dir, 'add', '-A');
      const pending = dryRun ? 'x' : await git(dir, 'status', '--porcelain');
      if (pending) await git(dir, 'commit', '-m', message);
      await git(dir, 'push', '-u', 'origin', branch);
      if (dryRun) return [{ sha: Math.random().toString(16).slice(2, 9), message }];
      const out = await git(dir, 'log', `origin/${base}..HEAD`, '--format=%h%x09%s');
      return out ? out.split('\n').map((l) => { const [sha, ...m] = l.split('\t'); return { sha, message: m.join('\t') }; }) : [];
    },
    // merge --no-ff de `from` em `into`, feito no worktree de integração, e push
    mergeInto(repo, from, into) {
      return serial(worktreesOf(repo), () => this._mergeInto(repo, from, into));
    },
    async _mergeInto(repo, from, into) {
      const dir = path.join(worktreesOf(repo), '_integration');
      if (!dryRun && !existsSync(dir)) {
        mkdirSync(worktreesOf(repo), { recursive: true });
        await git(repo.path, 'worktree', 'add', '--detach', dir);
      }
      await git(dir, 'fetch', 'origin');
      await git(dir, 'checkout', '-B', into, `origin/${into}`);
      await git(dir, 'merge', '--no-ff', `origin/${from}`, '-m', `Merge ${from} into ${into}`);
      await git(dir, 'push', 'origin', `HEAD:${into}`);
    },
    // uma linha no CHANGELOG.md da base, com commit e push, feita no worktree de integração
    appendChangelog(repo, base, line) {
      return serial(worktreesOf(repo), () => this._appendChangelog(repo, base, line));
    },
    async _appendChangelog(repo, base, line) {
      const dir = path.join(worktreesOf(repo), '_integration');
      if (!dryRun && !existsSync(dir)) {
        mkdirSync(worktreesOf(repo), { recursive: true });
        await git(repo.path, 'worktree', 'add', '--detach', dir);
      }
      await git(dir, 'fetch', 'origin');
      await git(dir, 'checkout', '-B', base, `origin/${base}`);
      if (!dryRun) {
        const file = path.join(dir, 'CHANGELOG.md');
        // a linha nova entra logo abaixo do título, a mais recente em cima
        const old = existsSync(file) ? readFileSync(file, 'utf8') : '# Changelog\n';
        const [head, ...rest] = old.split('\n');
        writeFileSync(file, [head, '', `- ${line}`, ...rest.filter((l, i) => i > 0 || l)].join('\n'));
      }
      await git(dir, 'add', 'CHANGELOG.md');
      await git(dir, 'commit', '-m', `docs(changelog): ${line}`);
      await git(dir, 'push', 'origin', `HEAD:${base}`);
    },
    // ── pull requests (gh, no diretório do repositório) ──
    // abre o PR da branch para a base, ou devolve o que já está aberto (a correção entra no mesmo PR)
    async openPr(repo, { head, base, title, body }) {
      if (dryRun) { log(`(dry-run) gh pr create --head ${head} --base ${base} --title "${title}"`); return { number: 0, url: null }; }
      const gh = (...args) => run('gh', args, { cwd: repo.path });
      try {
        const open = JSON.parse(await gh('pr', 'view', head, '--json', 'number,url,state'));
        if (open.state === 'OPEN') return { number: open.number, url: open.url };
      } catch { /* ainda não há PR para a branch */ }
      const url = await gh('pr', 'create', '--head', head, '--base', base, '--title', title, '--body', body.slice(0, 20000));
      return { number: Number(url.match(/\/pull\/(\d+)/)?.[1]), url: url.trim() };
    },
    async commentPr(repo, pr, body) {
      if (!pr?.number) return;
      await run('gh', ['pr', 'comment', String(pr.number), '--body', body.slice(0, 20000)], { cwd: repo.path });
    },
    // merge pelo GitHub (merge commit); falha se houver conflito ou regra de proteção da base
    async mergePr(repo, pr, subject) {
      if (dryRun) { log(`(dry-run) gh pr merge ${pr?.number} --merge`); return; }
      await run('gh', ['pr', 'merge', String(pr.number), '--merge', '--subject', subject], { cwd: repo.path });
    },
    async removeWorktree(repo, dir) {
      await git(repo.path, 'worktree', 'remove', '--force', dir).catch(() => {});
    },
    // a branch já entrou na base: apaga do remoto e do local, para não virar cemitério de branch
    async deleteBranch(repo, branch) {
      if (dryRun) { log(`(dry-run) git push --delete origin ${branch} · git branch -D ${branch}`); return; }
      await run('git', ['push', '--delete', 'origin', branch], { cwd: repo.path })
        .catch((err) => log(`branch ${branch}: já não existe no remoto (${err.message.slice(0, 100)})`));
      await git(repo.path, 'branch', '-D', branch).catch(() => {});
    },
  };
}

// GitHub Project (board). Lê os itens e move o status pelos ids do campo "Status".
export function createProject({ run, owner, number, statuses, dryRun }) {
  let fields = null;
  const gh = (...args) => run('gh', args);
  async function statusField() {
    if (fields) return fields;
    const list = JSON.parse(await gh('project', 'field-list', String(number), '--owner', owner, '--format', 'json'));
    const field = list.fields.find((f) => f.name === 'Status');
    const view = JSON.parse(await gh('project', 'view', String(number), '--owner', owner, '--format', 'json'));
    fields = { projectId: view.id, fieldId: field.id, options: Object.fromEntries(field.options.map((o) => [o.name, o.id])) };
    return fields;
  }
  return {
    async items() {
      if (dryRun) return [];
      const out = JSON.parse(await gh('project', 'item-list', String(number), '--owner', owner, '--format', 'json', '--limit', '1000'));
      return out.items || [];
    },
    async move(itemId, status) {
      if (dryRun || !itemId) return;
      const f = await statusField();
      const option = f.options[statuses[status] || status];
      if (!option) throw new Error(`o Project não tem a coluna "${statuses[status] || status}"`);
      await gh('project', 'item-edit', '--id', itemId, '--project-id', f.projectId, '--field-id', f.fieldId, '--single-select-option-id', option);
    },
    async create(title, body) {
      if (dryRun) return null;
      const out = JSON.parse(await gh('project', 'item-create', String(number), '--owner', owner, '--title', title, '--body', body, '--format', 'json'));
      return out.id;
    },
  };
}
