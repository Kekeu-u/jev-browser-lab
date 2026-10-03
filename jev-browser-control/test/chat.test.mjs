// Testa o laço do chat sem Chrome: fetch mockado + exec mockado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChat } from '../extension/lib/chat.js';

const settings = { provider: 'openrouter', openrouterKey: 'sk-or-test', textModel: 'fake/model' };

function withFetch(script, fn) {
  const real = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async () => {
    const content = script[i++];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content } }],
        usage: { cost: 0.001 },
      }),
    };
  };
  return fn().finally(() => { globalThis.fetch = real; });
}

test('uma rodada de ferramenta e depois a resposta final', async () => {
  const calls = [];
  await withFetch(
    [
      '{"fala":"","acao":{"ferramenta":"ler_pagina","args":{"limite":100}}}',
      '{"fala":"A página fala de café.","acao":null}',
    ],
    async () => {
      const out = await runChat({
        settings,
        history: [{ role: 'user', content: 'o que tem na página?' }],
        exec: async (tool, args) => { calls.push([tool, args]); return { content: 'texto sobre café' }; },
      });
      assert.equal(out.fala, 'A página fala de café.');
      assert.equal(out.rounds, 2);
      assert.deepEqual(calls, [['ler_pagina', { limite: 100 }]]);
    },
  );
});

test('ferramenta que explode vira erro para o modelo, não quebra o laço', async () => {
  await withFetch(
    [
      '{"fala":"","acao":{"ferramenta":"navegar","args":{"url":"https://x.com"}}}',
      '{"fala":"Não consegui navegar.","acao":null}',
    ],
    async () => {
      const out = await runChat({
        settings,
        history: [{ role: 'user', content: 'abre x.com' }],
        exec: async () => { throw new Error('site bloqueado'); },
      });
      assert.equal(out.fala, 'Não consegui navegar.');
    },
  );
});

test('sem chave: erro claro antes de qualquer chamada', async () => {
  await assert.rejects(
    runChat({
      settings: { provider: 'openrouter', openrouterKey: '', textModel: 'm' },
      history: [{ role: 'user', content: 'oi' }],
      exec: async () => ({}),
    }),
    /Sem chave/,
  );
});

test('abort devolve Interrompido', async () => {
  const ac = new AbortController();
  ac.abort();
  await withFetch(['{"fala":"x","acao":null}'], async () => {
    const out = await runChat({
      settings,
      history: [{ role: 'user', content: 'oi' }],
      exec: async () => ({}),
      signal: ac.signal,
    });
    assert.equal(out.fala, 'Interrompido.');
  });
});
