// Testes do fluxo da simulação: as regras que o escritório promete ao dono.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulatedFeed } from '../src/data/feed.js';

// orçamento alto para o teste não pausar no meio
const run = (ticks, setup) => {
  const feed = createSimulatedFeed();
  feed.setBudget(1e6);
  setup?.(feed);
  feed.step(ticks);
  return feed;
};
const texts = (t) => t.timeline.map((e) => e.text);
const indexOf = (t, re) => texts(t).findIndex((x) => re.test(x));
const lastIndexOf = (t, re) => texts(t).findLastIndex((x) => re.test(x));

test('as tasks andam do backlog até o merge e o total de entregas bate', () => {
  const feed = run(600);
  const merged = feed.board.filter((t) => t.column === 'merged');
  assert.ok(merged.length > 0, 'nenhuma task chegou ao merge');
  assert.equal(feed.delivered.at(-1), feed.reports.length);
});

test('nenhuma task vai para o merge sem passar pela segurança e pelo QA, nessa ordem', () => {
  const feed = run(800);
  for (const t of feed.board.filter((x) => x.column === 'merged')) {
    const sec = lastIndexOf(t, /^Segurança ok/);
    const qa = lastIndexOf(t, /^Aprovou/);
    assert.ok(sec >= 0, `${t.id} entrou sem revisão de segurança`);
    assert.ok(qa > sec, `${t.id}: o QA aprovou antes da segurança`);
    assert.ok(indexOf(t, /mandou para a revisão de segurança/) < sec, `${t.id}: revisão antes do dev terminar`);
  }
});

test('falha de segurança devolve a task para o mesmo dev', () => {
  const feed = run(1200);
  const back = feed.board.filter((t) => texts(t).some((x) => /^Falha /.test(x)));
  assert.ok(back.length > 0, 'nenhuma falha de segurança apareceu em 1200 rodadas');
  for (const t of back) {
    const after = texts(t).slice(indexOf(t, /^Falha /));
    assert.ok(after.some((x) => /^Voltou para corrigir/.test(x)) || t.column === 'rework', `${t.id} não voltou para o dev`);
  }
});

test('sugestão não vira task sem aprovação; aprovada vira, recusada não', () => {
  const feed = run(500);
  const pending = feed.ideas.filter((i) => i.status === 'aguardando' && !['release', 'post', 'divulgação'].includes(i.focus));
  assert.ok(pending.length >= 2, 'poucas sugestões para testar');
  const fromIdeas = () => feed.board.filter((t) => t.origin === 'idea').length;
  const before = fromIdeas();
  const [yes, no] = pending;
  feed.rejectIdea(no.id);
  assert.equal(fromIdeas(), before, 'recusar criou task');
  feed.approveIdea(yes.id);
  assert.equal(fromIdeas(), before + 1, 'aprovar não criou a task');
  assert.equal(feed.task(yes.taskId).column, 'todo');
  assert.equal(feed.task(yes.taskId).body, yes.detail, 'a task perdeu a descrição da melhoria');
});

test('nada vai para produção sem o release aprovado', () => {
  const feed = run(900);
  assert.equal(feed.board.filter((t) => t.released).length, 0, 'task em produção sem aprovação');
  const release = feed.ideas.find((i) => i.focus === 'release' && i.status === 'aguardando');
  assert.ok(release, 'o OPS não propôs release');
  feed.approveIdea(release.id);
  assert.equal(feed.releases.length, 1);
  for (const id of release.tasks) assert.ok(feed.task(id)?.released, `${id} ficou fora do release`);
});

test('ao bater o orçamento do dia, o escritório pausa e para de gastar', () => {
  const feed = createSimulatedFeed();
  feed.setBudget(1);
  feed.step(400);
  assert.ok(feed.paused, 'não pausou');
  assert.match(feed.pauseReason, /orçamento/);
  const spent = feed.spend.today;
  feed.step(50);
  assert.equal(feed.spend.today, spent, 'continuou gastando pausado');
});

test('pausado, nada anda; ao continuar, volta a andar', () => {
  const feed = run(50);
  feed.setPaused(true);
  const snapshot = JSON.stringify(feed.board.map((t) => [t.id, t.column, t.commits.length]));
  feed.step(100);
  assert.equal(JSON.stringify(feed.board.map((t) => [t.id, t.column, t.commits.length])), snapshot);
  feed.setPaused(false);
  feed.step(100);
  assert.notEqual(JSON.stringify(feed.board.map((t) => [t.id, t.column, t.commits.length])), snapshot);
});

test('robô pausado não trabalha', () => {
  const feed = run(0, (f) => f.setRobotPaused('WEB_01', true));
  feed.step(300);
  assert.equal(feed.getState('WEB_01').done, 0);
  assert.equal(feed.getState('WEB_01').cost, 0);
});

test('priorizar põe a task no topo do backlog', () => {
  const feed = run(0);
  const todo = () => feed.board.filter((t) => t.column === 'todo');
  const last = todo().at(-1);
  assert.ok(feed.prioritize(last.id));
  assert.equal(todo()[0].id, last.id);
});

test('a agência não agenda nem publica nada sem a sua aprovação', () => {
  const feed = run(600);
  const pieces = feed.marketing.pieces;
  assert.ok(pieces.some((p) => p.stage === 'aprovação'), 'nenhum criativo chegou à aprovação');
  assert.ok(!pieces.some((p) => ['agendado', 'publicado'].includes(p.stage)), 'publicou sem aprovação');
  const post = feed.ideas.find((i) => i.focus === 'post' && i.status === 'aguardando');
  feed.approveIdea(post.id);
  assert.equal(pieces.find((p) => p.id === post.piece).stage, 'agendado');
});

test('pedir ajuste devolve o criativo para a agência', () => {
  const feed = run(600);
  const post = feed.ideas.find((i) => i.focus === 'post' && i.status === 'aguardando');
  feed.adjustIdea(post.id, 'legenda mais curta');
  const piece = feed.marketing.pieces.find((p) => p.id === post.piece);
  assert.equal(piece.stage, 'ajuste');
  assert.equal(piece.fixBy, 'copy');
});

test('o canvas só marca como entregue a tela cuja task foi para o merge', () => {
  const feed = run(900);
  for (const sc of feed.canvas.screens.filter((s) => s.status === 'entregue' && s.taskId)) {
    assert.equal(feed.task(sc.taskId)?.column ?? 'merged', 'merged', `${sc.name} marcada sem merge`);
  }
});

test('a simulação volta igual depois de recarregar (memória no storage)', async () => {
  let saved = null;
  const storage = { get: () => saved, set: (v) => (saved = v), clear: () => (saved = null) };
  const a = createSimulatedFeed({ storage });
  a.setBudget(1e6);
  a.step(300);
  const post = a.ideas.find((i) => i.status === 'aguardando');
  a.approveIdea(post.id);
  await new Promise((r) => setTimeout(r, 1200)); // o save é agrupado em 1 s
  const b = createSimulatedFeed({ storage });
  assert.deepEqual(b.board.map((t) => [t.id, t.column]), a.board.map((t) => [t.id, t.column]));
  assert.equal(b.ideas.find((i) => i.id === post.id).status, 'aprovada');
  assert.equal(b.budget, 1e6);
  assert.ok(b.board.every((t) => t.createdAt instanceof Date), 'datas voltaram como texto');
  b.step(50); // continua andando depois de restaurado
  a.reset();
  assert.equal(saved, null);
});
