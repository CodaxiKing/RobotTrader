// Gera src/data/canvas.json a partir do índice do canvas de design do PetLive (project/canvas.json
// do artifact). Cada artboard vira uma tela com a fase e a seção dela no canvas: a fase é o título
// "Fase N · …" mais próximo acima da tela, e a seção, o título comum mais próximo acima.
//
//   npm run canvas:snapshot -- <caminho do project/canvas.json> [versão do artifact]
//
// O robô do canvas usa esse snapshot como "o que o canvas diz". Quando o motor dos agentes existir,
// é ele que lê o canvas a cada rodada; até lá, rode este script depois de mexer no canvas.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CANVAS_URL = 'https://claude.ai/artifact/UFhxFUGwCYokbjPKCXDqKK';
const [src, version = null] = process.argv.slice(2);
if (!src) {
  console.error('uso: npm run canvas:snapshot -- <project/canvas.json> [versão]');
  process.exit(1);
}

const index = JSON.parse(readFileSync(src, 'utf8'));
const titles = Object.values(index.notes || {})
  .filter((n) => n.kind === 'title1' && typeof n.text === 'string')
  .sort((a, b) => a.y - b.y);
const phases = titles.filter((n) => /^Fase \d/.test(n.text));
const sections = titles.filter((n) => !/^Fase \d/.test(n.text));
const above = (list, y) => list.filter((n) => n.y < y).at(-1);

// app do tutor e lojista no celular são React Native; o resto (lojista no computador, admin, site) é Next.js
function kindOf(title, w) {
  if (/^Painel admin/.test(title)) return 'admin';
  if (/^Site/.test(title) || w >= 1440) return 'site';
  if (/^Lojista computador/.test(title) || w >= 1280) return 'web';
  return 'app';
}

const screens = (index.order || Object.keys(index.boards))
  .map((file) => [file, index.boards[file]])
  .filter(([file, b]) => b && file.endsWith('.dc.html'))
  .map(([file, b]) => {
    const title = b.title || file.replace(/\.dc\.html$/, '');
    const phase = above(phases, b.y);
    const section = above(sections, b.y);
    return {
      file,
      title,
      // "Fase 1 · MVP: pet, saúde…" → número 1; sem fase é a identidade visual (0)
      phase: phase ? Number(phase.text.match(/^Fase (\d+)/)[1]) : 0,
      phaseName: phase ? phase.text : 'Identidade visual',
      section: section ? section.text : '',
      kind: kindOf(title, b.w),
      x: b.x, y: b.y, w: b.w, h: b.h,
    };
  })
  .filter((s) => s.phase > 0)
  .sort((a, b) => a.y - b.y || a.x - b.x);

const out = { title: index.title, url: CANVAS_URL, version, syncedAt: new Date().toISOString(), screens };
const dest = fileURLToPath(new URL('../src/data/canvas.json', import.meta.url));
writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`);
const byPhase = Object.groupBy(screens, (s) => s.phase);
console.log(`${screens.length} telas → src/data/canvas.json`);
for (const [p, list] of Object.entries(byPhase)) console.log(`  Fase ${p}: ${list.length}`);
