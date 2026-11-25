# TV alerts — bugs, correções e melhorias

Estado: código e TV em **0.5.38**; Notification Center **0.14.0**. Por decisão do Marcelo, **não implementar** a chave API-Football (P1-5) nem a deduplicação de notícias (B5). ESPN é o fornecedor a usar. As três melhorias pedidas na última sessão estão feitas e fechadas abaixo; não há outras ideias em aberto.

---

## Pedido atual — feito em 0.5.30

### 1. Vários picks do mesmo desporto — feito
Antes, dois picks com o mesmo desporto colidiam: a rota de config dedupava por `sport|teamId`, então um segundo pick sem `teamId` (F1 / corridas) era descartado, e `buildWatches()` agrupava todos os picks sem equipa sob a mesma chave `other:<sport>:all`.
- `pickKey(p)` usa `sport|teamId` quando há equipa e `sport|name` quando não há. Dois clubes de basquetebol com ids diferentes são dois picks distintos; duas corridas com nomes diferentes também. Pick duplicado (mesmo desporto + mesmo id/nome) continua a ser dedupado.
- `buildWatches()` usa `other:<sport>:<teamId||name>` por pick, pelo que cada pick tem o seu `watchStatus`, o seu `last[]` e o seu baseline de eventos. O scoreboard da competição continua a ser descarregado uma vez e partilhado (`compEvents`), mas a análise é por pick.
- O painel mostra a etiqueta do desporto em cada pick e desactiva **Adicionar** quando `cfg.maxPicks` (10) é atingido.

### 2. `/api/last` público — feito
`GET /api/last` (e `OPTIONS`) devolve `{version, at, historyAt, status, watches, next, civ, last, log}` com `Access-Control-Allow-Origin: *`, para widgets ou um mini-site. `last` traz só os baselines públicos (`at`, `state`, `desc`, `our`, `opp`), sem chaves de dedupe. Não inclui `config`, `keys`, `hasKey`, `providers`, `feeds`, `geocode` nem qualquer segredo do `ctx.config`. `/api/state` mantém-se como está (uso interno do painel).

### 3. Separar `index.js` em módulos — feito
- `providers/espn.js`: scoreboard, teams, events/scorer, resumo, next-fixture (`compCache`, `sumCache`, `dayCache`, `nextHint`). Recebe por injecção `getJson`, `clean`, `addLog`, `fmtKick` e `OTHER`; não faz notificações nem HTTP próprio.
- `providers/af.js`: API-Football opcional; a chave vem de `getKey()` injetado e nunca fica no módulo.
- `news.js`: RSS + Google News, baselines por feed, orçamento global de 4 manchetes/poll e espaçamento de 1 s. Recebe `getUrl`, `banner`, `schedule`, `status`, etc.
- `index.js` mantém o cliente HTTP local, `banner()`/fila, config, watches, análise desportiva, tempo, proteção civil, rotas e scheduler. Tudo em ES5/ASCII, `require()` local permitido pelo Vetro, 8 ficheiros no bundle (dentro de 20 / 512 KB). Caches e persistência (`nextHints`, `history.newsSeen`) passaram a usar os accessors dos módulos.

---

## Feitos (não refazer)

| Versão | O que |
|---|---|
| 0.4.2 | Capsa seca/modo correcto no painel; teste sem fontes; idioma não apaga alterações; news test; aviso single-banner. |
| 0.4.4 | Lugares personalizados com pesquisa por nome (geocoder Open-Meteo), até 10. |
| 0.4.6 | A1 competição que falha, A2 resumo duplicado, A3 teto de notícias, A7 cache de scoreboard. |
| 0.5.0 | B3 próximo jogo + aviso antes do apito (ESPN dia-a-dia, partilhado, cache 1 h); B1 escudo; P1-1 som dinâmico; P1-2 guardar ao adicionar. |
| 0.5.6 | P1-3 teste do aviso antes do jogo. |
| 0.5.9 | P1-4 aviso único entre restarts (`ctx.config.nextNotified`). |
| 0.5.14 | B6 histórico persistido; B7 volume por secção. |
| 0.5.15 | B4 teto global de 4 banners/minuto, 1 s entre eles, fila sem perdas. |
| 0.5.16 | Avisos de tempo proactivos (chuva/vento/calor/trovoada). |
| 0.5.20 | B2 alertas por clube. |
| 0.5.21 | B9 diagnóstico no painel. |
| 0.5.22 | NEXT optimizado (salto ao último dia encontrado). |
| 0.5.27 | Painel com 6 separadores, secções recolhíveis, barra fixa, Previous/Next, Save all. |
| 0.5.28 | B10 teste por clube; simulação de golos no separador Futebol. |
| 0.5.29 | Uniformização do painel: `.stack` de cartões largos com secções `<details>`; Estilo agrupado em cada separador. |
| 0.5.30 | Vários picks do mesmo desporto; `/api/last` público; `index.js` dividido em `providers/espn.js`, `providers/af.js`, `news.js`. |
| 0.5.31 | Dois picks F1 distinctos seguem corridas diferentes (id do evento ESPN via `/api/races`); testes versionados em `tests/` com runner único; `test_flow.js` com assertions. |
| 0.5.32 | Higiene: fontes ASCII (`\u`/entidades), `dist/`/`build/` ignorados pelo git, `build.ps1` corre check-nc antes de pack/install e usa packer vendido em `tools/vetro/`. |
| 0.5.33 | `/api/races` lista a época inteira (com fallback); painel desactiva Adicionar sem id de corrida; fila de banners limitada com log de drops; erros de notify registados; `npm test` + CI; `build.ps1` valida versão nos docs e limpa bundles antigos. |
| 0.5.34 | Tradução de `mode`; picker F1 sem corridas passadas; log de fila como `notify`; botão Adicionar bloqueado sem lista; relatório de saúde dos fornecedores + Limpar registo; botão Testar tudo; remoção da duplicação de notícias de clube (só em Futebol). |
| 0.5.35 | Novo separador **Técnico** com o Diagnóstico (antes em Geral), como no Shard do Notification Center; teste de Proteção Civil passa a enviar sempre um banner (aviso já visto, sem avisos ou módulo desligado). |
| 0.5.36 | Separador Geral passa a chamar-se **SETUP**; os quatro interruptores de módulos mostram/ocultam as tabs correspondentes (Desporto = Futebol + Outros desportos; Proteção Civil usa `civ.enabled`); parâmetros mantidos. |
| 0.5.37 | Auditoria: timers órfãos de banners, envios após stop, erros HTTP do NC não registados, escalação laranja→vermelho perdida, testes manuais em corrida com polls, pick F1 antigo seguir corrida errada, baseline legado parar o desporto, query malformada, sim vazio restaurado, tipos de config silentemente coercidos, retenção de hints/avisos. 21 testes. |
| 0.5.38 | Design/accessibilidade (tema claro/escuro, tokens, max-width, ARIA, hidden, confirmação em 2 cliques, erro amigável, exemplos curl/rotas); cartão no Control center com ações Check now; `status()` com civ/saúde; gate ES5 no CI; PR para o catálogo oficial. |
| várias | Vários clubes e competições, várias fontes, vários desportos, scoreboard só do clube escolhido, overlay, migração de configs antigas. |

---

## Ignorados por decisão do Marcelo

- **P1-5**: API-Football com chave real — o código existe, mas não se pede nem testa chave. ESPN é o fornecedor.
- **B5**: deduplicação de notícias — cada fonte mostra as suas manchetes.
- 8 (perfil `tv-alerts` no Notification Center): vai para o repositório do Notification Center, não para este Shard.
- 9 (pesquisa/filtro no painel): sem interesse.
- 10 (modo `both` com `action` no golo): preterido; o overlay actual é melhor.

---

## Nota de estado

TV: 3 clubes seguidos, 4 clubes de teste (Sporting/Benfica/Porto/Feyenoord), notícias **apenas Google News (PT)**, tempo em **Caldas da Rainha** (lat 39.40326, lon -9.13839), volumes todos em 100, aviso antes do jogo ligado a 30 min, teto global 4 banners/minuto.
Separadores (6): Geral, Tempo, Notícias, Proteção Civil, Futebol (com a simulação de golos lá dentro), Outros desportos. Cada separador tem uma coluna `.stack` de cartões largos com secções recolhíveis; Estilo (Modo/Som/Volume) agrupado em cada separador.
Pontos de restauro: `_backup-tv-alerts-0.4.5-*` a `_backup-tv-alerts-0.5.29-*` em `C:\Users\marce\Documents\Projeto Padrão\`.
