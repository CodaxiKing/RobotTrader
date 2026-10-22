// Git e GitHub para o motor. Os robôs nunca mexem no checkout do dono: cada task tem o seu
// worktree, e o merge acontece num worktree de integração. Em dry-run, só registra o comando.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function createGit({ dryRun, log }) {
  function run(cmd, args, { cwd } = {}) {
    if (dryRun) {
      log(`(dry-run) ${cmd} ${args.join(' ')}${cwd ? `  [${cwd}]` : ''}`);
      return Promise.resolve('');
    }
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd} ${args.join(' ')}: ${(stderr || err.message).trim()}`));
        else resolve(stdout.trim());
      });
    });
  }
  const git = (cwd, ...args) => run('git', args, { cwd });
  const worktreesOf = (repo) => `${repo.path.replace(/[\\/]+$/, '')}-worktrees`;

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
    async mergeInto(repo, from, into) {
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
    async appendChangelog(repo, base, line) {
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
    async removeWorktree(repo, dir) {
      await git(repo.path, 'worktree', 'remove', '--force', dir).catch(() => {});
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
      const out = JSON.parse(await gh('project', 'item-list', String(number), '--owner', owner, '--format', 'json', '--limit', '200'));
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
