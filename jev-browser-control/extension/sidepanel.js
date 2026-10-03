const $ = (id) => document.getElementById(id);
const port = chrome.runtime.connect({ name: 'panel' });
let running = null; // taskId mostrado no log
let confirmId = null;
let busy = false;

const OP_LABEL = { CLICK: 'CLICK', TYPE_TEXT: 'TYPE', SELECT: 'SELECT', PRESS_ENTER: 'ENTER', SCROLL_DOWN: 'SCROLL', SCROLL_UP: 'SCROLL', BACK: 'BACK', WAIT: 'WAIT', DONE: 'DONE', BLOCKED: 'BLOCKED' };

const TOOL_LABEL = {
  pagina_atual: 'olhando a aba atual',
  ler_pagina: 'lendo a página',
  navegar: 'navegando',
  tarefa: 'executando no navegador',
  verificar: 'verificando a página',
};

function setClaude(connected) {
  const el = $('claude');
  el.querySelector('.dot').className = 'dot' + (connected ? ' on' : '');
  el.querySelector('span:last-child').textContent = connected ? 'Claude conectado' : 'Claude off';
}

function setRemote({ enabled, connected }) {
  const el = $('remote');
  el.hidden = !enabled;
  el.querySelector('.dot').className = 'dot' + (connected ? ' on' : ' warn');
  el.querySelector('span:last-child').textContent = connected ? 'Remote on' : 'Remote: conectando';
}

function setProvider(s) {
  const el = $('provider');
  const name = s.provider === 'cloud' ? 'Credits' : s.provider === 'custom' ? 'Custom' : 'OpenRouter';
  el.querySelector('.dot').className = 'dot' + (s.key_set ? ' on' : ' warn');
  el.querySelector('span:last-child').textContent = s.key_set ? name : `${name}: sem chave`;
}

// ---------- chat ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => (n < 0.01 ? '$' + n.toFixed(4) : '$' + n.toFixed(3));

function bubble(role, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = html;
  $('chat').appendChild(div);
  div.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return div;
}

function notice(text) {
  return bubble('tool', `<span>${esc(text)}</span>`);
}

function setBusy(on) {
  busy = on;
  $('send').hidden = on;
  $('chat-stop').hidden = !on;
  $('msg').disabled = on;
  if (!on) $('msg').focus();
}

const TOOL_RUN = new Map(); // aviso "executando…" -> substitui pelo resultado

port.onMessage.addListener((msg) => {
  if (msg.type === 'state') {
    setClaude(msg.bridge.connected);
    setProvider(msg.settings);
    if (msg.relay) setRemote(msg.relay);
    if (msg.running.length) { running = msg.running[0].taskId; }
  } else if (msg.type === 'bridge') setClaude(msg.connected);
  else if (msg.type === 'relay') setRemote(msg);
  else if (msg.type === 'settings') setProvider(msg.settings);
  else if (msg.type === 'chat-typing') {
    setBusy(true);
    bubble('jev typing', '<span class="dots">…</span>');
  } else if (msg.type === 'chat-event') {
    const e = msg.event;
    if (e.type === 'tool') {
      const args = e.args || {};
      const detail = e.tool === 'tarefa' && args.objetivo ? `: ${args.objetivo}` : e.tool === 'navegar' && args.url ? `: ${args.url}` : '';
      TOOL_RUN.set(e.tool, notice(`▶ ${TOOL_LABEL[e.tool] || e.tool}${detail}`));
    } else if (e.type === 'tool-result') {
      const el = TOOL_RUN.get(e.tool);
      if (el) { el.remove(); TOOL_RUN.delete(e.tool); }
      notice(`${e.ok ? '✔' : '✖'} ${TOOL_LABEL[e.tool] || e.tool}`);
    }
  } else if (msg.type === 'chat-done') {
    document.querySelectorAll('.msg.typing').forEach((el) => el.remove());
    setBusy(false);
    bubble('jev', esc(msg.fala).replace(/\n/g, '<br>'));
    if (msg.cost) $('cost').textContent = usd(msg.cost);
  } else if (msg.type === 'chat-error') {
    document.querySelectorAll('.msg.typing').forEach((el) => el.remove());
    setBusy(false);
    bubble('jev err', esc(msg.message));
  } else if (msg.type === 'event') onEvent(msg.event);
  else if (msg.type === 'idle') { if (!busy) running = null; }
  else if (msg.type === 'error' && !busy) bubble('jev err', esc(msg.message));
  else if (msg.type === 'confirm-expired') {
    if (msg.id === confirmId) { $('confirm').hidden = true; confirmId = null; }
  } else if (msg.type === 'confirm') {
    confirmId = msg.id;
    let host = msg.url;
    try { host = new URL(msg.url).hostname; } catch {}
    $('confirm-text').textContent = `O Jev quer clicar em “${msg.label}” em ${host}. Isso pode ser difícil de desfazer.`;
    $('confirm').hidden = false;
    $('allow').focus();
  }
});

// Passos das tarefas seguem no log detalhado (mesmo formato de antes).
function li(html, cls = '') {
  const el = document.createElement('li');
  el.className = cls;
  el.innerHTML = html;
  $('log').appendChild(el);
  el.scrollIntoView({ block: 'nearest' });
  return el;
}
const pct = (n) => (typeof n === 'number' ? Math.round(n * 100) + '%' : '');

function onEvent(e) {
  if (e.type === 'start') {
    running = e.taskId;
    $('log').innerHTML = '';
    li(`<span class="n">▸</span><span class="what">${esc(e.goal)}</span><span></span>`);
    return;
  }
  if (e.taskId !== running) return;
  if (e.type === 'action') {
    const op = OP_LABEL[e.operation] || e.operation;
    const failed = String(e.outcome).startsWith('failed');
    li(`<span class="n">${e.step}</span><span class="what"><span class="op">${op}</span>${esc(e.action)}${e.text ? `<span class="typed">“${esc(e.text)}”</span>` : ''}</span><span class="meta">${pct(e.target_confidence ?? e.confidence)}</span>`, failed ? 'failed' : '');
    $('cost').textContent = usd(e.cost || 0);
  } else if (e.type === 'end') {
    running = null;
    const ok = e.status === 'done';
    li(`<span class="n">${ok ? '✔' : '✖'}</span><span class="what">${esc(e.status)}${e.note ? `<span class="typed">${esc(e.note)}</span>` : ''}</span><span class="meta">${e.steps.length} ações</span>`, ok ? '' : 'failed');
    $('cost').textContent = usd(e.cost_usd || 0);
  }
}

$('chat-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (busy) return;
  const text = $('msg').value.trim();
  if (!text) return;
  $('msg').value = '';
  bubble('user', esc(text).replace(/\n/g, '<br>'));
  $('log').innerHTML = '';
  port.postMessage({ type: 'chat', text, mode: $('mode').value });
});
$('msg').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) $('chat-form').requestSubmit();
});
$('chat-stop').addEventListener('click', () => {
  port.postMessage({ type: 'chat-stop' });
  port.postMessage({ type: 'stop' });
});
$('claude').addEventListener('click', () => port.postMessage({ type: 'reconnect' }));

const answer = (ok) => { port.postMessage({ type: 'confirm', id: confirmId, ok }); $('confirm').hidden = true; confirmId = null; };
$('allow').addEventListener('click', () => answer(true));
$('deny').addEventListener('click', () => answer(false));

$('mode').addEventListener('change', () => chrome.storage.local.set({ chatMode: $('mode').value }));
chrome.storage.local.get('chatMode').then(({ chatMode }) => { if (chatMode) $('mode').value = chatMode; });

bubble('jev', 'Oi! Eu sou o Jev — controlo as abas deste navegador com seus logins. Escolha o modo acima e mande um comando: <i>“pesquise o preço do dólar e me diga”</i>, <i>“abra meu TikTok Studio e traga as métricas da semana”</i>… Ações irreversíveis eu pergunto antes.');
port.postMessage({ type: 'getState' });
