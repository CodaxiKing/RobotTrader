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
| 01 · Produto | `PO_01` | Pega a task do board (GitHub Project), **confere no código se a funcionalidade já existe no app** (se existir, marca a task como Done sem implementar de novo), escreve os critérios de aceite e passa para um dev livre da área. |
| 01 · Produto | `CANVAS_01` | Mantém o canvas de design ([Wireframes App de Pets](https://claude.ai/artifact/UFhxFUGwCYokbjPKCXDqKK)) e o código em dia: marca as telas entregues, percebe artboard que mudou, aponta telas sem task e telas que faltam. |
| 02 · Desenvolvimento | `WEB_01..03` (Next.js), `APP_01..03` (React Native) | Implementam numa branch, com commit e push, e mandam para a segurança. |
| 03 · Segurança | `SEC_01`, `SEC_02` | Revisa o diff de toda task (diff pequeno ganha revisão leve) (injeção, XSS, IDOR, segredos, permissões, CVEs). Achou furo: devolve para o dev com a gravidade e como corrigir. Livre, audita o que já foi entregue. |
| 04 · Qualidade | `QA_01..02` (web), `QA_03..04` (app) | Testam. Aprovado: merge em `develop` e relatório. Reprovado: volta para o dev. |
| 05 · Operações | `OPS_01`, `DOCS_01`, `DATA_01` | OPS propõe o release para produção e vigia erros em produção; DOCS escreve o CHANGELOG e as notas para as lojas; DATA lê o uso das telas. |
| 06 · Melhorias | `CODE_01`, `PERF_01`, `DESIGN_01`, `UX_01`, `A11Y_01` | Sugerem melhorias de código, performance, design, UX e acessibilidade. |
| 07 · Marketing | `MKT_LEAD`, `ROTEIRO_01`, `COPY_01`, `ARTE_01`, `VIDEO_01`, `REVISOR_01`, `SOCIAL_01` | Agência: monta a pauta (lançamentos do app e conteúdo para tutores), escreve roteiros, legendas e hashtags, cria os criativos e vídeos (Instagram, TikTok, Shorts, Facebook, LinkedIn), avalia cada peça por gancho, clareza, marca, CTA e formato, devolve para ajuste quando a nota é baixa, agenda e publica **só depois da sua aprovação**, acompanha os números e propõe formas de divulgação. |
| Sala de reunião | — | Task que volta duas vezes junta P.O, dev e quem devolveu; o P.O reescreve os critérios com o que falhou. |

## O que é decisão sua

- **Aprovações** (botão ✦ e o contador): sugestões de melhoria, telas do canvas, achados de dados e acessibilidade, o **release para produção**, os **posts** da agência (aprovar e agendar, pedir ajuste com um comentário, ou recusar) e as **ideias de divulgação**. Nada disso acontece sem você.
- **Produção**: os robôs só fazem merge em `develop`. O `OPS_01` junta as entregas num release a cada 4, e ele só vai para `main` quando você aprova.
- **Pausa**: ⏸ no topo pausa todo mundo; no cartão de cada robô dá para pausar só ele.
- **Orçamento**: o gasto do dia aparece no topo. Ao bater o limite (`OFFICE.dailyBudgetUsd`, padrão US$ 20) o escritório pausa sozinho; dá para aumentar o limite pela faixa de aviso ou em Métricas. No motor, `robotDailyUsd` ainda põe teto por robô: quem estoura o seu para só ele, e volta sozinho quando o dia vira (ou quando você retomar).
- **Prioridade**: no Board, arraste os cards do Backlog. O P.O sempre pega o primeiro que tem dev livre.
- **Conversa**: no cartão do robô, pergunte o que ele está fazendo, por que devolveu uma task, quanto gastou, ou mande `prioriza #123`, `pausa`, `continua`.

## Painéis

Board (com busca e filtro de coluna, a descrição da melhoria no próprio card e, ao clicar, o que é a task, os critérios de
aceite do P.O e a linha do tempo), Canvas, Aprovações, Marketing (funil da agência, prévia de cada criativo com legenda, roteiro, notas da avaliação e números), Relatórios do QA, Produção (releases, erros e
CHANGELOG), Hoje (resumo pronto para copiar no WhatsApp), Métricas (tempo por task, reprovação no QA e na segurança, filas,
gargalo, gasto por robô), Histórico (tudo o que aconteceu e cada decisão sua, com busca), Telas e modo TV.
Os painéis das paredes também são clicáveis. 🔔 liga os avisos do navegador (aprovações, falhas altas, erros em produção, orçamento).
O mapa no canto mostra o salão de cima, com um ponto por robô; clicar numa zona leva a câmera até ela. ☀ alterna o tema claro.

Os criativos da agência saem nos templates da marca PetLive (cores, famílias pastel e a fonte Plus Jakarta Sans do artboard
"Paleta de cores" do canvas): cabeçalho com onda, cartão pastel, pergunta em fundo preto e print do app. No motor, com
uma chave do [Pexels](https://www.pexels.com/api/), entra também a foto do banco de imagens (abaixo).

## Rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. Sem parâmetros o escritório usa a **simulação**: o fluxo inteiro roda sozinho no navegador.

- `?floor=po|dev|sec|qa|ops|lab` enquadra uma zona; `?panel=board|canvas|ideas|reports|releases|today|metrics|audit|screens` abre um painel.
- `?tv=1` liga o modo TV (passa pelas zonas e mostra o resumo do dia). No celular, o botão de aprovações fica em destaque.
- `?theme=light` abre no tema claro.
- `?live=1` liga o escritório no **motor** (abaixo).

A simulação **lembra de tudo** neste navegador (aprovações, prioridade, orçamento, agência) e continua de onde parou ao
recarregar. Para recomeçar do zero: `?reset=1`, ou "Recomeçar do zero" em Métricas.

## Testes

```bash
npm test
```

Testam as regras do fluxo na simulação: segurança e QA antes de todo merge, falha devolvida ao dev, sugestão só vira task
aprovada (e a task guarda a descrição da melhoria no corpo), nada vai para produção sem o release aprovado, o orçamento
pausa o escritório, pausa e prioridade, a agência não
publica sem aprovação, a memória volta igual, e o caminho dos robôs até a sala de reunião.

Também testam o **motor** em modo ensaio (`test/motor.test.mjs`, sem API nem git): o P.O marca como Done quando a
funcionalidade já existe (e isso não vira entrega, release nem relatório), a correção de produção nunca é marcada como
"já existia", o check fica cacheado por título, a reunião adia quando o P.O está pausado, a branch é apagada depois do
merge, o teto por robô pausa só quem estourou, a ideia aprovada vira task no board guardando a descrição da melhoria, e o
release aprovado leva o lote
para produção com a versão. No ensaio, `MOTOR_DRY_FAST=1` deixa tudo instantâneo e
`MOTOR_DRY_EXISTS=1|0` / `MOTOR_DRY_FAIL=1|0` forçam as respostas.

## Motor (agentes de verdade)

A pasta `motor/` roda os agentes com o [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) na sua máquina:

```
GitHub Project (Todo) → P.O (confere se já existe; se não, critérios) → dev (worktree, commit, push) → segurança (diff) → QA (testes)
→ merge em develop → release proposto pelo OPS → main só com a sua aprovação
```

- Cada task roda num `git worktree` próprio (`<repo>-worktrees/`), e o merge acontece num worktree de integração: **o seu checkout nunca é tocado**. Depois do merge, a worktree e a branch (remota e local) são apagadas; task bloqueada há mais de 3 dias também perde worktree e branch (destravar recomeça do zero), para não virar cemitério.
- Commit, push e merge são do orquestrador. Os agentes não podem dar `git push`, `merge`, `checkout`, `reset` nem `rm -rf`; só o dev edita arquivos.
- Cada agente tem um teto de gasto (`budgets`), e o custo real (`total_cost_usd`) entra no orçamento do dia; `robotDailyUsd` põe ainda um teto diário **por robô** (só quem estoura para, e volta a trabalhar sozinho quando o dia vira — o acumulado continua nas métricas).
- Falha transitória (rate limit, rede, GitHub fora do ar) ganha **uma tentativa nova** antes de travar a task; o limite do plano nunca é engolido: estaciona a task com o mesmo robô e o motor retoma sozinho.
- Task que voltou duas vezes vira reunião: o P.O reescreve os critérios com o que falhou antes da próxima tentativa (quem está pausado não vai; sem o P.O, a reunião adia).
- O "confere se já existe" do P.O fica em cache por título: a mesma tela aprovada duas vezes no canvas não gasta o check duas vezes.

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

Além do fluxo principal, o motor roda os robôs de apoio, cada um de tempos em tempos (`extras` na config; no ensaio os
minutos viram segundos):

| Robô | No motor |
|---|---|
| `DOCS_01` | Uma linha no `CHANGELOG.md` de `develop` a cada merge; um agente escreve as notas de cada release para as lojas. |
| `CANVAS_01` | Telas planejadas do canvas (até `canvas.maxPhase`) sem task viram sugestão; aprovada, vira item do Project. Sem custo de agente. |
| `OPS_01` | Com `SENTRY_AUTH_TOKEN` + `config.sentry.org/.project`, lê os erros de produção das últimas 24 h: cada um vira incidente na aba Produção e uma sugestão de correção para a sua aprovação; aprovada, entra no board como correção (`origin: ops`). |
| `DATA_01` | Com `config.analytics.url` (ou a env `ANALYTICS_URL`) devolvendo `{"screens":[{"name":"Início","views":1230}]}`, lê o uso das telas, publica as mais vistas no painel Hoje e avisa quando o uso de uma tela cai mais de 40%. Sem fonte, fica parado dizendo isso. |
| Melhorias | Um robô por vez (`ideas.everyMinutes`) lê o código, só leitura, e sugere uma melhoria com evidência; vai para a sua aprovação. |
| Agência | Pauta → roteiro e legenda (agentes) → arte no template da marca, com foto do banco de imagens → avaliação (agente) → sua aprovação → **publica sozinho** quando a API da Meta está ligada (e lê os números do post); sem a chave, fica **pronto para postar** e você publica na mão. Se a publicação falhar, tenta de novo em 10 minutos (máximo 3) e depois espera você. Com resultado de dois posts no ar, o MKT_LEAD **propõe uma forma de divulgação por vez**. |

**Fotos dos criativos:** o `COPY_01` escreve, junto com a legenda, a busca da foto de acordo com a pauta (em inglês, por
exemplo `dog at veterinarian`), e o `ARTE_01` / `VIDEO_01` pega no [Pexels](https://www.pexels.com/api/) uma foto que
ainda não foi usada (quadrada no post, em pé na capa do vídeo) e monta o criativo com ela no fundo ou no cabeçalho. A
chave é grátis: ponha `PEXELS_API_KEY=...` em `motor/.env` (fora do git) e reinicie o motor; funciona também no ensaio.
Sem chave, a arte sai só no template, como antes. O painel da peça mostra o crédito do fotógrafo.

**Chaves opcionais em `motor/.env` (fora do git):** `PEXELS_API_KEY` (foto dos criativos), `META_ACCESS_TOKEN` + `META_PAGE_ID` (publicar foto/link sozinho e ler os números do post; vídeo continua manual), `SENTRY_AUTH_TOKEN` + `config.sentry.org/.project` (erros de produção) e `ANALYTICS_URL` + `config.analytics.url` (uso das telas). Todas são opcionais: sem elas, cada robô avisa que está sem fonte e o resto segue.

**Ainda sem ligação:** imagem e vídeo gerados por IA, e a publicação de vídeo nas redes (a API da Meta publica foto e link por URL; vídeo precisa de upload manual); no motor esses ficam com o passo manual e o escritório avisa.

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
| `src/main.js` | Câmera, interface, avisos, modo TV, tema. |
| `src/ui/panels.js` | Os painéis do overlay (board, canvas, aprovações, agência, relatórios, produção, hoje, métricas, histórico). |
| `src/ui/minimap.js` | O mapa pequeno do salão. |
| `src/paths.js` | O caminho dos robôs entre mesa, sofá e sala de reunião. |
| `test/` | Testes do fluxo simulado e do motor em ensaio (`npm test`). |
| `motor/` | Servidor local, orquestrador, agentes (Agent SDK), robôs de apoio (`extras.mjs`) e git/GitHub. |

## Origem

A arquitetura de feed (simulado/ao vivo) e a organização da interface se inspiram em
[sidatreya/agent-office](https://github.com/sidatreya/agent-office), que **não declara licença**.
Nenhum código foi copiado: a cena, os robôs e as telas foram reescritos. Se for distribuir, confirme isso com o autor.
