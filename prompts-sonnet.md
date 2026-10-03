# Prompts para o Sonnet 5 — revisão do painel jev

Como usar: cole um prompt por vez no Sonnet 5. Quando o prompt pedir, **anexe os arquivos** indicados (estão em `C:\Apps\jev browser\front\`). Os dois prompts são independentes.

---

## Prompt 1 — Segurança e robustez (anexe `server.js` e `index.html`)

```
Revise os dois arquivos anexados. É um painel local (roda em 127.0.0.1:8787) que
comanda uma CLI de automação de navegador (jev-browser, Playwright) na máquina do
usuário, Windows. O server.js não usa dependências: serve a página, recebe
POST /api/run com {task, url, maxSteps, maxSeconds, delayMs}, lê a chave
OPENROUTER_API_KEY de front/.env, injeta no ambiente do processo filho (a CLI) e
nunca devolve a chave pra página. A página nunca recebe conteúdo do .env. Prints
das execuções ficam em front/runs/*.jpg e são servidos em /runs/.

Já implementei: checagem de Host + Sec-Fetch-Site + Origin (403 em cross-site e
DNS rebinding), trava de execução única (running) reservada no aceite do POST e
liberada em todo caminho de saída, kill da árvore de processo via taskkill /T no
Windows, handler de SIGINT/SIGTERM que mata o filho, leitura de arquivo antes do
writeHead (crash de double-writeHead corrigido), cap de stdout (1 MB) e do corpo
(100 KB com 413), retenção de 20 screenshots, path.relative pra travar /runs/.

Quero que você procure o que PASSOU por essas defesas: (1) algum cenário real em
que um site externo ainda consiga disparar /api/run ou ler um screenshot; (2)
falhas no ciclo de vida dos processos no Windows (órfãos, kill no meio de write,
restart do service worker); (3) tratamento de chave: algum caminho em que ela
vaze pra log, pra página ou pra mensagem de erro; (4) condições de corrida
restantes no Node single-thread (eventos req: data/end/close vs. callbacks do
filho); (5) qualquer resposta que trave o servidor por exceção não pega.

Responda com achados ranqueados por severidade, cada um com o cenário de
exploração/falha em 1-2 frases e o patch mínimo proposto (diff curto). Não
reescreva o arquivo; só patches pontuais. Se concluir que algo já está bem
tratado, diga em uma linha por quê, pra eu não ficar com dúvida.
```

---

## Prompt 2 — Arquitetura e evolução (anexe `server.js` e `index.html`)

```
Contexto: painel web local que comanda a CLI jev-browser (agente de navegador
dirigido pelo modelo Jev via OpenRouter; cada ação do agente é uma decisão de
~300ms; a CLI imprime UM único JSON de resultado no stdout no fim do run, com
steps[], usage e screenshot; durante a execução ela não emite progresso no
stdout). Hoje o painel fica sem feedback além de um cronômetro até o run
terminar. Também existe um modo alternativo: uma extensão Chrome (Jev Browser
Control) que roda as mesmas tarefas dentro do Chrome real do usuário, com painel
lateral próprio, e um servidor MCP que permite um LLM planejar e a extensão
executar.

Quero evoluir o painel considerando: (1) progresso em tempo real — avalie as
opções (SSE com parse do trace interno, webSocket, polling de um arquivo de
estado, ou instrumentar a lib via import de navigate.js em vez de spawnar a
CLI), com custo/benefício de cada uma num app sem dependências; (2) fila de
execuções em vez de 409 quando já há um run ativo; (3) como expor a pausa entre
ações (delayMs) de forma mais útil (presets: calmo/normal/agressivo?) sem
incentivar uso abusivo contra sites de terceiros; (4) valerá a pena unificar
painel próprio e extensão, ou mantê-los como modos separados (isolado vs. Chrome
real)? Criterie por manutenção por um dev solo.

Responda com: recomendação principal para cada ponto, alternativas descartadas
com o motivo, e um roteiro de implementação na ordem que daria mais valor
primeiro. Seja direto: opinião formada, não survey.
```

---

## Trecho do patch de pacing (se o Sonnet perguntar ou você quiser incluir)

Em `jev-browser\src\navigate.ts`, após o registro de cada step executado:

```ts
const pacingMs = Number(process.env.JEV_BROWSER_ACTION_DELAY_MS);
if (Number.isFinite(pacingMs) && pacingMs > 0 && step < maxSteps) {
  await page.waitForTimeout(bounded(Math.min(pacingMs, 60_000)));
}
```

`bounded(cap)` espera no máximo o tempo restante do run (mínimo 250 ms). Os
caminhos `done`/`goal_achieved`/`stuck` saem do loop antes desse trecho.
