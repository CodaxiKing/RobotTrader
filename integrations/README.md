# Exportadores (MT5 e NinjaTrader)

```
EA do MT5 ─┐
           ├─ POST /report ─▶ server/aggregator.mjs ─▶ public/status.json ─▶ escritório (?live=1)
AddOn NT8 ─┘
```

> **Status:** o agregador foi testado de ponta a ponta (token, ID desconhecido, deduplicação, eventos e leitura pelo app).
> O **EA do MT5 e o AddOn do NinjaTrader não foram compilados nem executados** — não há MetaTrader/NinjaTrader nesta máquina.
> Compile, abra o log e valide com uma conta demo antes de confiar nos números.

## 1. Agregador

```bash
npm run aggregator            # http://127.0.0.1:8787, grava public/status.json
npm run dev                   # em outro terminal; abra http://localhost:5173/?live=1
```

Variáveis opcionais: `PORT`, `HOST`, `ROBOT_OFFICE_TOKEN`, `STATUS_FILE`.
Se o MT5/NT rodar em **outra máquina** (VPS, por exemplo), use `HOST=0.0.0.0` **e** defina `ROBOT_OFFICE_TOKEN`
(o mesmo valor no EA/AddOn), e libere a porta só para esse IP. Sem token, qualquer um que alcance a porta pode escrever no seu painel.

Os `id`s precisam existir em `src/data/robots.js` (`PA_01…PA_12`, `NT_01…NT_08`). IDs desconhecidos são ignorados e avisados no log.

## 2. MetaTrader 5

1. Copie `mt5/RobotOfficeReporter.mq5` para `MQL5/Experts/` (MT5 → Arquivo → Abrir pasta de dados), abra no MetaEditor e compile (F7).
2. MT5 → Ferramentas → Opções → Expert Advisors → marque **Permitir WebRequest** e adicione `http://127.0.0.1:8787`.
3. Arraste o EA para qualquer gráfico e configure:
   - **Uma conta = um robô** (caso do PA_01…): deixe `RobotMap` vazio e ponha o id em `RobotId`.
   - **Vários robôs na mesma conta:** `RobotMap = 1001=PA_01;1002=PA_02` (magic number = id).
4. Repita em cada terminal/conta.

Como cada campo é calculado:

| Campo | Origem |
|---|---|
| `status` | `operating` se há posição aberta do robô, senão `rest` |
| `openPnl` | soma de `POSITION_PROFIT + POSITION_SWAP` |
| `closedPnl` | soma dos negócios do dia (`profit + comissão + swap + taxa`, inclui custos de entrada) |
| `setup` | comentário da posição aberta (faça seu robô gravar ali, ex.: `SETUP 3.1`) |
| `trades` | negócios de saída do dia; horário convertido para UTC |
| `balance` | saldo da conta (igual para todos os robôs da mesma conta) |

## 3. NinjaTrader 8

1. Copie `ninjatrader/RobotOfficeReporter.cs` para `Documents\NinjaTrader 8\bin\Custom\AddOns\`.
2. NinjaTrader → New → NinjaScript Editor → compile (F5).
3. Reinicie o NinjaTrader. Na primeira vez ele cria `Documents\NinjaTrader 8\robot-office.txt`. Edite:

```
url=http://127.0.0.1:8787/report
token=
account:Sim101=NT_01
account:MinhaContaProp=NT_02
```

Aqui **cada conta é um robô**. O AddOn só enxerga contas, não estratégias individuais.

Limitações conhecidas:
- `closedPnl` é o P&L realizado da conta na sessão; as "últimas operações" são **variações** desse valor entre relatórios, não ordens individuais (se duas fecharem no mesmo intervalo de 5 s, aparecem somadas).
- `setup` fica fixo em `FUTURES`.
- Se o NinjaTrader recusar algum nome de API na compilação, o ponto mais provável é `Account.Get(AccountItem…)`; me mande o erro do editor.
