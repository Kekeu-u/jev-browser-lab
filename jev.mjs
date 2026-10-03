#!/usr/bin/env node
// Supervisor do serviço jev browser — start / stop / status / setup.
// Multiplataforma (Windows, macOS, Linux). Isolamento: o servidor roda com
// pidfile próprio; `stop` encerra a cadeia inteira (servidor → CLI → Chromium)
// sem deixar processo órfão. Log da sessão em front/runs/server.log.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, mkdirSync, copyFileSync, openSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FRONT = join(ROOT, "front");
const RUNS = join(FRONT, "runs");
const REPO = join(ROOT, "jev-browser");
const SERVER = join(FRONT, "server.js");
const PIDFILE = join(RUNS, ".server.pid");
const LOG = join(RUNS, "server.log");
const PORT = Number(process.env.FRONT_PORT || 8787);
const URL = `http://127.0.0.1:${PORT}`;
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

const say = (msg) => console.log(msg);
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

function nodeVersionOk() {
  const [maj] = process.versions.node.split(".").map(Number);
  return maj >= 22;
}

async function status() {
  try {
    const r = await fetch(`${URL}/api/status`, { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function readPidfile() {
  try { return Number(readFileSync(PIDFILE, "utf8")); } catch { return null; }
}

function openBrowser(url) {
  try {
    if (IS_WIN) {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (IS_MAC) {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {}
}

// Derruba a árvore inteira: no Windows taskkill /T /F; no POSIX mata o grupo
// (o servidor sobe detached, logo tem grupo próprio) com TERM e depois KILL.
function killTree(pid) {
  if (!pid || pid <= 0) return;
  if (IS_WIN) {
    const exe = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    try {
      spawnSync(exe, ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  } else {
    for (const sig of ["SIGTERM", "SIGKILL"]) {
      try { process.kill(-pid, sig); } catch {}
      try { process.kill(pid, sig); } catch {}
      sleepMs(600);
    }
  }
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmdSetup() {
  if (!nodeVersionOk()) return die(`Precisa de Node 22+ (voce esta no ${process.versions.node}).`);
  say("- Instalando dependencias da CLI (jev-browser)...");
  const npm = IS_WIN ? "npm.cmd" : "npm";
  const r1 = spawnSync(npm, ["install"], { cwd: REPO, stdio: "inherit", shell: IS_WIN });
  if (r1.status !== 0) return die("npm install falhou em jev-browser/.");
  say("- Compilando a CLI...");
  const r2 = spawnSync(npm, ["run", "build"], { cwd: REPO, stdio: "inherit", shell: IS_WIN });
  if (r2.status !== 0) return die("build falhou em jev-browser/.");
  say("- Baixando o Chromium da Playwright (pula sozinho se ja existir)...");
  const r3 = spawnSync(npm, ["exec", "playwright", "install", "chromium"], { cwd: REPO, stdio: "inherit", shell: IS_WIN });
  if (r3.status !== 0) return die("playwright install chromium falhou.");
  const envPath = join(FRONT, ".env");
  if (!existsSync(envPath)) {
    copyFileSync(join(FRONT, ".env.example"), envPath);
    say("- Criei front/.env a partir do exemplo.");
    say("  AGORA COLE SUA CHAVE DO OPENROUTER dentro dele (openrouter.ai/settings/keys).");
  }
  say("\nSetup completo. Suba o servico com:  node jev.mjs start");
}

const sep = () => (IS_WIN ? "\\" : "/");

async function cmdStart() {
  if (!nodeVersionOk()) return die(`Precisa de Node 22+ (você está no ${process.versions.node}).`);
  if (!existsSync(SERVER)) return die("front/server.js não encontrado — rode da raiz do projeto.");
  if (!existsSync(join(REPO, "dist", "index.js"))) {
    return die("CLI não compilada. Rode primeiro:  node jev.mjs setup");
  }
  if (!existsSync(join(FRONT, ".env"))) {
    say("[!] front/.env nao existe - configure a chave pelo painel");
    say("    (link 'chave' no topo da pagina) ou crie a partir de front/.env.example.");
  }

  // Instância única: já de pé? Só abre o painel de novo.
  const already = await status();
  if (already && already.pid) {
    say(`Ja esta rodando (pid ${already.pid}). Abrindo ${URL} ...`);
    openBrowser(URL);
    return;
  }

  // Log da sessão com teto: acima de 1 MB, recomeça.
  try {
    mkdirSync(RUNS, { recursive: true });
    if (existsSync(LOG) && statSync(LOG).size > 1_000_000) writeFileSync(LOG, "");
  } catch {}
  const logFd = (() => { try { return fsOpenAppend(LOG); } catch { return "ignore"; } })();

  // Detached em TODAS as plataformas: o servidor escapa do grupo/console de
  // quem o lançou (fecha o terminal, o serviço continua). No POSIX vira grupo
  // próprio (kill -grupo no stop); no Windows, CREATE_NEW_PROCESS_GROUP.
  const child = spawn(process.execPath, [SERVER], {
    cwd: FRONT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();
  say(`- Servidor subindo (pid ${child.pid})...`);

  for (let i = 0; i < 40; i++) {
    await sleepMs(250);
    const s = await status();
    if (s && s.pid) {
      say(`[ok] Painel em ${URL}  (pid ${s.pid})`);
      say(`  Parar tudo: node jev.mjs stop   |   ver estado: node jev.mjs status`);
      say(`  Log da sessao: front/runs/server.log`);
      openBrowser(URL);
      return;
    }
    if (child.exitCode !== null) {
      return die(`O servidor saiu logo ao subir (codigo ${child.exitCode}). Veja front/runs/server.log`);
    }
  }
  killTree(child.pid);
  die("O servidor nao respondeu em 10s. Veja front/runs/server.log.");
}

function fsOpenAppend(file) { return openSync(file, "a"); }

async function cmdStop() {
  const s = await status();
  if (!s || !s.pid) {
    try { if (existsSync(PIDFILE)) unlinkSync(PIDFILE); } catch {}
    return say("Nao esta rodando.");
  }
  const pid = s.pid;
  say(`- Parando servidor (pid ${pid}) e toda a arvore de processos...`);
  killTree(pid);
  for (let i = 0; i < 20; i++) {
    await sleepMs(300);
    const gone = await status();
    if (!gone) {
      try { if (existsSync(PIDFILE)) unlinkSync(PIDFILE); } catch {}
      return say("[ok] Parado. Nada ficou rodando (servidor, CLI e Chromium encerrados).");
    }
  }
  say("[!] Ainda respondeu apos o kill - confira manualmente o pid " + pid);
}

async function cmdStatus() {
  const s = await status();
  if (!s || !s.pid) {
    say("Parado. Suba com:  node jev.mjs start");
    return;
  }
  say(`Rodando: ${URL}  (pid ${s.pid})`);
  say(`  chave: ${s.hasKey ? "configurada" : "FALTANDO no front/.env"} | execucao em andamento: ${s.running ? "sim" : "nao"} | fila: ${s.queued}`);
}

const cmd = (process.argv[2] || "start").toLowerCase();
const cmds = { setup: cmdSetup, start: cmdStart, stop: cmdStop, status: cmdStatus };
if (!cmds[cmd]) die(`Uso: node jev.mjs [start|stop|status|setup]  (default: start)`);
cmds[cmd]();
