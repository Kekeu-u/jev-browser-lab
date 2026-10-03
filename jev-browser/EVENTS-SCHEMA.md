# Contrato compartilhado: eventos de run, HTTP do painel e presets

Fonte única para o painel local (`../front/`) e qualquer outra UI (ex.: extensão).
Alterou aqui, atualize as duas UIs.

## 1. Eventos de passo da CLI (`--events`)

Com `--events`, a CLI escreve em stderr **uma linha NDJSON por passo**, no fim do
registro do passo (inclui passos que um watcher parou antes da execução —
`executed_action: null`). O objeto é exatamente o mesmo de `steps[]` no JSON
final de stdout (e os watchers done/goal/stuck saem do loop antes de emitir
qualquer linha extra):

```json
{ "step": 3, "t_ms": 1240, "proposed_action": "click_e7", "executed_action": "click_e7",
  "detail": "a \"Sign in\" -> /login", "confidence": 0.98, "outcome": "page changed: ..." }
```

Com `--live-shot <path>`, a CLI também **sobrescreve** esse JPEG com um print da
página após cada ação executada (~100ms por passo, best-effort). O painel serve
o arquivo em `GET /runs/<id>-live.jpg` e recarrega a imagem a cada evento de
passo; o arquivo é removido no fim do run (o print final vem no resultado).

Linhas de stderr que não forem JSON com `step` são log humano/erro — nunca
evento. O stdout continua carregando **um único** JSON de resultado no fim.

Variáveis de ambiente da CLI usadas pelo painel:

| Variável | Efeito |
| --- | --- |
| `JEV_BROWSER_ACTION_DELAY_MS` | Pausa em ms após cada ação executada (0 = off; teto 10000 no painel) |
| `JEV_BROWSER_ALLOW_PRIVATE_NET=1` | Desativa o bloqueio de rede privada do agente (padrão: bloqueado) |
| `JEV_BROWSER_HEADED=1` | Navegador visível |

## 2. HTTP do painel (front/server.js)

| Rota | Método | Contrato |
| --- | --- | --- |
| `/api/run` | POST | `{task, url, maxSteps, maxSeconds, delayMs}` → `202 {id, status, queue}` na hora. Erros de validação: 400/413/415/429 sem criar run |
| `/api/runs/:id` | GET | Snapshot completo do run (estado + eventos + resultado) — reconexão e fallback de polling |
| `/api/runs/:id/events` | GET | SSE (`text/event-stream`). Repasso dos eventos já acumulados + novos. Frames: `{type:"step", step}` / `{type:"status", status}` / `{type:"end", status, error}`. Stream termina no `end` |
| `/api/runs/:id/cancelar` | POST | Cancela na fila ou mata a árvore em execução (`cancelled` com passos parciais) |
| `/api/runs` | GET | Lista `{runs:[{id, task, status, createdAt}]}` — memória + disco (sobrevive a restart) |
| `/api/status` | GET | `{hasKey, running, queued}` |
| `/runs/run-<ts>.jpg` | GET | Screenshot final |

Status possíveis do run: `queued | running | done | failed | cancelled | interrupted`.
Persistência: `front/runs/<id>.json` ao lado do `run-<ts>.jpg`; retenção de 20.

Segurança: todas as rotas exigem origem própria (Host exato + Sec-Fetch-Site +
Origin); navegação digitada (`Sec-Fetch-Site: none`) só vale para `/`. O agente
(Playwright) bloqueia rede privada por padrão — ver tabela acima.

## 3. Presets de ritmo (fonte única)

| Preset | delayMs enviado | Piso no server | Uso |
| --- | --- | --- | --- |
| Observar | 2000 | 750 (terceiros) | Acompanhar ao vivo, poder intervir |
| Padrão | 800 (default) | 750 (terceiros) | Uso normal |
| Rápido | 0 | **0 só em hosts próprios**; em terceiro sobe para 750 | Sites seus, localhost, `*.local`, `FAST_HOSTS` no `.env` |

O piso vale no **servidor** (trava na UI é cosmética). Teto absoluto: 10000 ms.
Sem jitter aleatório de propósito: pausa fixa e previsível, cortesia — não
disfarmação de bot. O que realmente limita abuso: teto de passos, concorrência
1 e fila com teto. Respeitar ToS/robots.txt de terceiros é decisão do usuário.
