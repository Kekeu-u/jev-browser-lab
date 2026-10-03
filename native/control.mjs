// Controle de computador do jev browser — multiplataforma (Win/macOS/Linux).
// Substitui os protótipos em PowerShell por nut.js (binários nativos).
//
// CLI (usável por agente, app nativo ou terminal):
//   node control.mjs shot <caminho.png>
//   node control.mjs click <x> <y>          (duplo: dblclick)
//   node control.mjs move <x> <y>           (só move; pos = lê posição)
//   node control.mjs type <texto>           (digita caractere a caractere)
//   node control.mjs paste <texto>          (cola via área de transferência)
//   node control.mjs key <combo>            (ex: ctrl+l, enter, alt+tab)
//   node control.mjs activate <parte-do-titulo>
//   node control.mjs windows                (lista janelas com título)
//
// API (import): cada comando é uma função exportada.
import {
  mouse, Point, keyboard, Key, screen, clipboard, getWindows,
} from "@nut-tree-fork/nut-js";

mouse.config.autoDelayMs = 60;
mouse.config.mouseSpeed = 2000;
keyboard.config.autoDelayMs = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function shot(path) {
  // capture(fileName) grava e devolve o caminho salvo; dims via captureImage
  const saved = await screen.capture(path);
  return { path: saved ?? path };
}

export async function click(x, y, { button = "left", double = false } = {}) {
  const b = button === "right" ? 2 : button === "middle" ? 1 : 0;
  await mouse.setPosition(new Point(Number(x), Number(y)));
  await sleep(150);
  await mouse.click(b);
  if (double) { await sleep(90); await mouse.click(b); }
  return { ok: true, x: Number(x), y: Number(y) };
}

export async function dblclick(x, y) {
  return click(x, y, { double: true });
}

export async function move(x, y) {
  await mouse.setPosition(new Point(Number(x), Number(y)));
  return { ok: true };
}

export async function pos() {
  const p = await mouse.getPosition();
  return { x: p.x, y: p.y };
}

export async function type(text) {
  await keyboard.type(String(text));
  return { ok: true };
}

export async function paste(text) {
  await clipboard.setContent(String(text));
  await sleep(80);
  await keyboard.pressKey(Key.LeftControl, Key.V);
  await keyboard.releaseKey(Key.LeftControl, Key.V);
  return { ok: true };
}

const KEYS = {
  enter: Key.Enter, tab: Key.Tab, esc: Key.Escape, escape: Key.Escape,
  backspace: Key.Backspace, delete: Key.Delete, up: Key.Up, down: Key.Down,
  left: Key.Left, right: Key.Right, home: Key.Home, end: Key.End,
  pageup: Key.PageUp, pagedown: Key.PageDown, space: Key.Space,
  ctrl: Key.LeftControl, control: Key.LeftControl, alt: Key.LeftAlt,
  shift: Key.LeftShift, cmd: Key.LeftSuper, win: Key.LeftSuper, meta: Key.LeftSuper,
  f1: Key.F1, f2: Key.F2, f3: Key.F3, f4: Key.F4, f5: Key.F5, f6: Key.F6,
  f7: Key.F7, f8: Key.F8, f9: Key.F9, f10: Key.F10, f11: Key.F11, f12: Key.F12,
};

export async function key(combo) {
  const parts = String(combo).toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const mods = [];
  const normals = [];
  for (const p of parts) {
    if (["ctrl", "control", "alt", "shift", "cmd", "win", "meta"].includes(p)) mods.push(KEYS[p]);
    else if (KEYS[p]) normals.push(KEYS[p]);
    else if (p.length === 1) normals.push(p.toUpperCase().charCodeAt(0)); // letras/números: KeyA etc é o keyCode
    else throw new Error(`tecla desconhecida: ${p}`);
  }
  if (!mods.length && !normals.length) throw new Error("combo vazio");
  await keyboard.pressKey(...mods, ...normals);
  await keyboard.releaseKey(...mods, ...normals);
  return { ok: true, combo: parts.join("+") };
}

export async function windows() {
  const ws = await getWindows();
  const out = [];
  for (const w of ws) {
    try {
      const title = await w.title;
      if (title && title.trim()) out.push({ title, pid: await w.pid });
    } catch {}
  }
  return out;
}

export async function activate(titlePart) {
  const ws = await getWindows();
  for (const w of ws) {
    try {
      const t = await w.title;
      if (t && t.includes(titlePart)) {
        await w.focus();
        await sleep(350);
        return { ok: true, title: t };
      }
    } catch {}
  }
  throw new Error(`janela não encontrada: ${titlePart}`);
}

// ---------- CLI ----------

const [cmd, ...rest] = process.argv.slice(2);
const CMDS = {
  shot: () => shot(rest[0]),
  click: () => click(rest[0], rest[1]),
  dblclick: () => dblclick(rest[0], rest[1]),
  move: () => move(rest[0], rest[1]),
  pos: () => pos(),
  type: () => type(rest.join(" ")),
  paste: () => paste(rest.join(" ")),
  key: () => key(rest[0]),
  activate: () => activate(rest.join(" ")),
  windows: () => windows(),
};

if (cmd && CMDS[cmd]) {
  CMDS[cmd]()
    .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(String(e.message || e)); process.exit(1); });
} else if (cmd) {
  console.error(`uso: node control.mjs <shot|click|dblclick|move|pos|type|paste|key|activate|windows> [args]`);
  process.exit(2);
}
