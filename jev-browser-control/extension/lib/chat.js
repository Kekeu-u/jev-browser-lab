// Chat com LLM no painel lateral. Protocolo JSON (não depende de tool-calling
// nativo: funciona com qualquer modelo de chat do provedor configurado).
// O modelo escolhe ferramentas que o background já possui; o Jev executa as
// ações de navegador. Sem APIs do Chrome aqui dentro: testável em Node.
import { endpoints } from './provider.js';

export const SYSTEM = `Você é o Jev, o assistente que vive no navegador do usuário e age nas abas dele (com os logins dele).
Responda SEMPRE com UM objeto JSON, sem nenhum texto fora dele:
{"fala": "resposta breve em português do Brasil", "acao": null}
ou, quando precisar agir ou olhar a página antes de responder:
{"fala": "", "acao": {"ferramenta": "<nome>", "args": {}}}
Ferramentas disponíveis:
- pagina_atual {} — url, título e elementos clicáveis da aba atual.
- ler_pagina {limite?} — o texto da página atual (padrão 8000 caracteres).
- navegar {url, nova_aba?} — abre a url (apenas http/https).
- tarefa {objetivo, detalhes?} — o Jev executa vários passos na página até o objetivo; o usuário confirma ações irreversíveis. Use para qualquer coisa que exija cliques, buscas ou formulários.
- verificar {afirmacao} — pergunta sim/não sobre a página atual, julgada só pelo que está na tela.
Regras: para agir, prefira "tarefa" com objetivo curto e claro (uma coisa por vez); para responder sobre uma página, leia antes e nunca invente conteúdo; você não pratica automação de engajamento em redes sociais (curtir, comentar, seguir ou rolar feed em volume); se faltar um dado (senha, dado pessoal, escolha do usuário), peça em "fala" com acao null; seja breve.`;

async function chatOnce(ep, settings, messages, signal) {
  let res;
  try {
    res = await fetch(ep.chat, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ep.chatKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.textModel || 'inception/mercury-2.5',
        max_tokens: 900,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`Sem resposta do provedor: ${err.message}`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  if (!json) throw new Error('O provedor devolveu algo que não é JSON.');
  return json;
}

/**
 * @param {object} o
 * @param {object} o.settings   provider/textModel (makeProvider-style settings)
 * @param {Array}  o.history    [{role:'user'|'assistant', content}] — o turno novo já incluído
 * @param {function} o.exec     async (ferramenta, args) => resultado serializável
 * @param {AbortSignal} [o.signal]
 * @param {function} [o.onEvent] ({type:'tool'|'tool-result', ...})
 * @returns {Promise<{fala: string, cost: number, rounds: number}>}
 */
export async function runChat({ settings, history, exec, signal, onEvent = () => {} }) {
  const ep = endpoints(settings);
  if (!ep.chatKey) throw new Error('Sem chave configurada. Abra as opções da extensão e cole a chave.');
  const messages = [{ role: 'system', content: SYSTEM }, ...history];
  let cost = 0;
  for (let round = 0; round < 10; round++) {
    if (signal?.aborted) return { fala: 'Interrompido.', cost, rounds: round };
    const json = await chatOnce(ep, settings, messages, signal);
    cost += Number(json.usage?.cost) || 0;
    const content = String(json.choices?.[0]?.message?.content ?? '');
    let out = null;
    try { out = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || 'null'); } catch {}
    if (!out || typeof out !== 'object' || !out.acao || !out.acao.ferramenta) {
      const fala = String(out?.fala ?? content).trim();
      return { fala: fala.slice(0, 4000) || '(o modelo não respondeu nada)', cost, rounds: round + 1 };
    }
    const { ferramenta } = out.acao;
    const args = out.acao.args && typeof out.acao.args === 'object' ? out.acao.args : {};
    onEvent({ type: 'tool', tool: ferramenta, args });
    let result;
    try {
      result = await exec(ferramenta, args);
    } catch (err) {
      if (signal?.aborted) return { fala: 'Interrompido.', cost, rounds: round + 1 };
      result = { erro: String(err.message || err).slice(0, 300) };
    }
    onEvent({ type: 'tool-result', tool: ferramenta, ok: !result?.erro });
    messages.push({ role: 'assistant', content: JSON.stringify(out) });
    messages.push({
      role: 'user',
      content: `RESULTADO de ${ferramenta}:\n${JSON.stringify(result).slice(0, 6000)}\n\nResponda com o JSON. Se já pode responder ao usuário, use "acao": null.`,
    });
  }
  return { fala: 'Parei após 10 rodadas de ferramentas — peça para continuar se quiser.', cost, rounds: 10 };
}
