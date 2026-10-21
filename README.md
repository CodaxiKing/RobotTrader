# RobotTrader · Escritório virtual

Escritório 3D isométrico (voxel + neon amarelo) para acompanhar robôs de trading.
Cada robô é um boneco numa mesa: **operando** fica sentado digitando, **em descanso** vai para o sofá.
Balões mostram o saldo de cada robô, a parede mostra o resultado do andar e clicar abre a tela dele.

## Rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. Por padrão usa **dados simulados**.

- `?live=1` lê `./status.json` (a cada 5 s). Veja `public/status.example.json`.
- `?floor=mt5`, `?floor=nt` ou `?floor=all` abre direto em um andar / no prédio.

## Usar dados reais

O app só precisa de um `status.json` neste formato (servido em `public/status.json`, ou outro host):

```json
{
  "updatedAt": "2026-10-21T15:00:00Z",
  "robots": [
    { "id": "PA_01", "status": "operating", "setup": "SETUP 3.1", "symbol": "EURUSD", "side": "BUY",
      "openPnl": 12.34, "closedPnl": 265.14, "balance": 25000, "trades": [] }
  ],
  "events": [{ "time": "2026-10-21T14:10:00Z", "robotId": "PA_01", "text": "Fechou EURUSD SELL · +41.20" }]
}
```

`status` é `operating` ou `rest`. Quem escreve esse arquivo é o agregador (`npm run aggregator`), alimentado pelo
EA do MT5 e pelo AddOn do NinjaTrader — instalação em [`integrations/README.md`](integrations/README.md).

## Estrutura

| Arquivo | O que faz |
|---|---|
| `src/data/robots.js` | Andares e robôs (quantidade, prefixo, símbolos). Edite aqui para mudar o escritório. |
| `src/data/feed.js` / `live.js` | Fonte simulada / fonte ao vivo (mesma interface). |
| `src/world.js` | Cena: andares, paredes neon, mesas, sofás, robôs andando, balões. |
| `src/robot.js` | Robô voxel e suas animações. |
| `src/screens.js` | Desenho dos monitores, painéis de parede e tela grande. |
| `src/main.js` | Câmera isométrica, UI, filtros, cliques. |

## Origem

A arquitetura de feed (simulado/ao vivo) e a organização da interface se inspiram em
[sidatreya/agent-office](https://github.com/sidatreya/agent-office), que **não declara licença**.
Nenhum código foi copiado: a cena, os robôs e as telas foram reescritos. Se for distribuir, confirme isso com o autor.
