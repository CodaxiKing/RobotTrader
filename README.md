# PetLive · Escritório de robôs

Escritório 3D isométrico (voxel + neon amarelo) dos robôs que desenvolvem o SaaS **PetLive**.
Todos ficam num salão só, em duas alas: no fundo, Produto, Desenvolvimento, Segurança e Qualidade (a ordem do fluxo);
na frente, atrás de uma divisória de vidro, Operações, Melhorias, Marketing e a sala de reunião. Cada ala tem a sua área
de descanso, e um corredor junto à parede esquerda liga as duas.
Robô **trabalhando** fica sentado digitando, **livre** vai para o sofá, **em reunião** vai para a sala de reunião.
Sobre cada robô, um balão mostra a task e a atividade, com um indicador: ⏸ pausado, 💬 em reunião, ⚠ travado, z livre.

## Zonas e robôs

| Zona | Robôs | O que fazem |
|---|---|---|
| 01 · Produto | `PO_01` | Pega a task do board (GitHub Project), escreve os critérios de aceite e passa para um dev livre da área. |
| 01 · Produto | `CANVAS_01` | Mantém o canvas de design ([Wireframes App de Pets](https://claude.ai/artifact/UFhxFUGwCYokbjPKCXDqKK)) e o código em dia: marca as telas entregues, percebe artboard que mudou, aponta telas sem task e telas que faltam. |
| 02 · Desenvolvimento | `WEB_01..03` (Next.js), `APP_01..03` (React Native) | Implementam numa branch, com commit e push, e mandam para a segurança. |
| 03 · Segurança | `SEC_01` | Revisa o diff de toda task (injeção, XSS, IDOR, segredos, permissões, CVEs). Achou furo: devolve para o dev com a gravidade e como corrigir. Livre, audita o que já foi entregue. |
| 04 · Qualidade | `QA_01..02` (web), `QA_03..04` (app) | Testam. Aprovado: merge em `develop` e relatório. Reprovado: volta para o dev. |
| 05 · Operações | `OPS_01`, `DOCS_01`, `DATA_01` | OPS propõe o release para produção e vigia erros em produção; DOCS escreve o CHANGELOG e as notas para as lojas; DATA lê o uso das telas. |
| 06 · Melhorias | `CODE_01`, `PERF_01`, `DESIGN_01`, `UX_01`, `A11Y_01` | Sugerem melhorias de código, performance, design, UX e acessibilidade. |
| 07 · Marketing | `MKT_LEAD`, `ROTEIRO_01`, `COPY_01`, `ARTE_01`, `VIDEO_01`, `REVISOR_01`, `SOCIAL_01` | Agência: monta a pauta (lançamentos do app e conteúdo para tutores), escreve roteiros, legendas e hashtags, cria os criativos e vídeos (Instagram, TikTok, Shorts, Facebook, LinkedIn), avalia cada peça por gancho, clareza, marca, CTA e formato, devolve para ajuste quando a nota é baixa, agenda e publica **só depois da sua aprovação**, acompanha os números e propõe formas de divulgação. |
| Sala de reunião | — | Task que volta duas vezes junta P.O, dev e quem devolveu; o P.O reescreve os critérios com o que falhou. |

## O que é decisão sua

- **Aprovações** (botão ✦ e o contador): sugestões de melhoria, telas do canvas, achados de dados e acessibilidade, o **release para produção**, os **posts** da agência (aprovar e agendar, pedir ajuste com um comentário, ou recusar) e as **ideias de divulgação**. Nada disso acontece sem você.
- **Produção**: os robôs só fazem merge em `develop`. O `OPS_01` junta as entregas num release a cada 4, e ele só vai para `main` quando você aprova.
- **Pausa**: ⏸ no topo pausa todo mundo; no cartão de cada robô dá para pausar só ele.
- **Orçamento**: o gasto do dia aparece no topo. Ao bater o limite (`OFFICE.dailyBudgetUsd`, padrão US$ 20) o escritório pausa sozinho; dá para aumentar o limite pela faixa de aviso ou em Métricas.
- **Prioridade**: no Board, arraste os cards do Backlog. O P.O sempre pega o primeiro que tem dev livre.
- **Conversa**: no cartão do robô, pergunte o que ele está fazendo, por que devolveu uma task, quanto gastou, ou mande `prioriza #123`, `pausa`, `continua`.

## Painéis

Board (com a linha do tempo de cada task ao clicar), Canvas, Aprovações, Marketing (funil da agência, prévia de cada criativo com legenda, roteiro, notas da avaliação e números), Relatórios do QA, Produção (releases, erros e
CHANGELOG), Hoje (resumo pronto para copiar no WhatsApp), Métricas (tempo por task, reprovação no QA e na segurança, filas,
gargalo, gasto por robô), Histórico (tudo o que aconteceu e cada decisão sua, com busca), Telas e modo TV.
Os painéis das paredes também são clicáveis. 🔔 liga os avisos do navegador (aprovações, falhas altas, erros em produção, orçamento).

## Rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. Sem parâmetros o escritório usa a **simulação**: o fluxo inteiro roda sozinho no navegador.

- `?floor=po|dev|sec|qa|ops|lab` enquadra uma zona; `?panel=board|canvas|ideas|reports|releases|today|metrics|audit|screens` abre um painel.
- `?tv=1` liga o modo TV (passa pelas zonas e mostra o resumo do dia). No celular, o botão de aprovações fica em destaque.
- `?live=1` liga o escritório no **motor** (abaixo).

## Motor (agentes de verdade)

A pasta `motor/` roda os agentes com o [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) na sua máquina:

```
GitHub Project (Todo) → P.O (critérios) → dev (worktree, commit, push) → segurança (diff) → QA (testes)
→ merge em develop → release proposto pelo OPS → main só com a sua aprovação
```

- Cada task roda num `git worktree` próprio (`<repo>-worktrees/`), e o merge acontece num worktree de integração: **o seu checkout nunca é tocado**.
- Commit, push e merge são do orquestrador. Os agentes não podem dar `git push`, `merge`, `checkout`, `reset` nem `rm -rf`; só o dev edita arquivos.
- Cada agente tem um teto de gasto (`budgets`), e o custo real (`total_cost_usd`) entra no orçamento do dia.
- Task que voltou duas vezes vira reunião: o P.O reescreve os critérios com o que falhou antes da próxima tentativa.

### Primeiro, o ensaio

```bash
npm run motor:dry    # terminal 1: sem API, sem git, sem GitHub
npm run dev          # terminal 2
```

Abra `http://localhost:5173/?live=1`. O ensaio usa o backlog da Fase 1 do canvas e respostas falsas, e serve para conferir
o fluxo, os botões e o escritório antes de gastar.

### Depois, valendo

1. Copie `motor/config.example.json` para `motor/config.json` (fica fora do git) e preencha:
   - `project.owner` e `project.number`: o GitHub Project do PetLive; os nomes das colunas em `project.statuses`;
   - `repos.web.path` / `repos.app.path`: onde estão os repositórios Next.js e React Native, e o `testCommand` de cada um;
   - `dailyBudgetUsd` e os tetos por agente em `budgets`; `model` (padrão `claude-opus-5-5`).
2. Garanta: `gh auth login` (com escopo `project`), credencial da Anthropic (`ANTHROPIC_API_KEY` ou `ant auth login`)
   e a branch `develop` existindo no remoto de cada repositório.
3. Proteja a `main` no GitHub (o motor só escreve nela quando você aprova um release).
4. `npm run motor` e `npm run dev`; abra com `?live=1`.

As tasks entram pela coluna Todo do Project; a área (web ou app) sai das labels (`appLabels`). O estado fica em
`motor/state.json` (fora do git) e sobrevive a um reinício.

**O que o motor ainda não faz:** a agência de marketing, os robôs de canvas, melhorias, acessibilidade, dados, documentação contínua e a
auditoria de segurança ociosa rodam só na simulação; no motor eles ficam livres. O motor cobre o fluxo principal
(P.O, devs, segurança, QA, reunião e release).

## Canvas

As telas vêm de `src/data/canvas.json`, um snapshot do canvas com a fase e a seção de cada artboard. Depois de mexer no
canvas, gere o snapshot de novo a partir do `project/canvas.json` dele:

```bash
npm run canvas:snapshot -- <caminho do project/canvas.json> [versão]
```

## Estrutura

| Arquivo | O que faz |
|---|---|
| `src/data/robots.js` | Zonas, papéis, robôs, orçamento e branches. Edite aqui para mudar a equipe; o salão cresce sozinho. |
| `src/data/feed.js` | Simulação de todo o fluxo, com as mesmas ações do motor. |
| `src/data/marketing.js` | A agência de marketing: pauta, roteiro, texto, criação, avaliação, aprovação, publicação e divulgação. |
| `src/data/live.js` | Lê o estado do motor e manda as ações (`/status.json`, `/api/*`). |
| `src/data/stats.js` | Métricas e resumo do dia, para a simulação e para o motor. |
| `src/world.js` | Cena: salão, zonas, sala de reunião, mesas, robôs, balões e painéis de parede clicáveis. |
| `src/screens.js` | Desenho dos monitores, painéis de parede, canvas e tela grande. |
| `src/main.js` | Câmera, interface, painéis, avisos, modo TV. |
| `motor/` | Servidor local, orquestrador, agentes (Agent SDK) e git/GitHub. |

## Origem

A arquitetura de feed (simulado/ao vivo) e a organização da interface se inspiram em
[sidatreya/agent-office](https://github.com/sidatreya/agent-office), que **não declara licença**.
Nenhum código foi copiado: a cena, os robôs e as telas foram reescritos. Se for distribuir, confirme isso com o autor.
