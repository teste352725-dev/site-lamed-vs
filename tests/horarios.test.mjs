import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as srv from "../server/_regras-tempo.mjs";
import { renderProductPage, normalizeProduct, parseFirestoreFields } from "../scripts/build-catalog-pages.mjs";

// Regras da loja (js/app-core.js) num contexto isolado.
function regrasDaLoja({ admin = false, schedules = [], colecoes = [] } = {}) {
  const src = readFileSync(new URL("../js/app-core.js", import.meta.url), "utf8");
  const ini = src.indexOf("let allStorefrontProducts");
  const fim = src.indexOf("function agendarProximaVirada");
  const ctx = { currentUserIsAdmin: admin, storeOperationsState: { discountSchedules: schedules }, activeCollections: colecoes, products: [] };
  vm.runInNewContext(`${src.slice(ini, fim)}\nthis.api = { descontoEfetivo, colecaoAindaNaoComecou, colecaoJaTerminou, aplicarRegrasDeTempo, inicioDaColecao, fimDaColecao };`, ctx);
  return ctx.api;
}
const H = (iso) => new Date(iso).getTime();

test("desconto 'válido até' termina na hora exata (loja e servidor iguais)", () => {
  const peca = { desconto: 15, descontoAte: "2026-11-22T21:00:00-03:00" };
  const loja = regrasDaLoja();
  for (const [quando, esperado] of [["2026-11-22T20:59:00-03:00", 15], ["2026-11-22T21:00:00-03:00", 0], ["2026-11-23T08:00:00-03:00", 0]]) {
    assert.equal(srv.descontoEfetivo(peca, H(quando)), esperado, `servidor ${quando}`);
    assert.equal(loja.descontoEfetivo(peca, H(quando)), esperado, `loja ${quando}`);
  }
});

test("'tirar todos os descontos' vale na hora e só para descontos anteriores ao horário", () => {
  const schedules = [{ enabled: true, runAt: "2026-11-22T21:00:00-03:00", lastRunAt: "" }];
  const loja = regrasDaLoja({ schedules });
  const antigo = { desconto: 10, descontoDefinidoEm: "2026-11-20T10:00:00-03:00" };
  const semData = { desconto: 10 };
  const novo = { desconto: 20, descontoDefinidoEm: "2026-11-22T21:30:00-03:00" };
  const depois = H("2026-11-22T22:00:00-03:00");
  for (const [peca, esperado] of [[antigo, 0], [semData, 0], [novo, 20]]) {
    assert.equal(srv.descontoEfetivo(peca, depois, schedules), esperado);
    assert.equal(loja.descontoEfetivo(peca, depois), esperado);
  }
  assert.equal(srv.descontoEfetivo(antigo, H("2026-11-22T20:00:00-03:00"), schedules), 10, "antes da hora ainda vale");
  const executado = [{ ...schedules[0], lastRunAt: "2026-11-23T00:14:00-03:00" }];
  assert.equal(srv.descontoEfetivo(novo, depois, executado), 20);
});

test("coleção: peças só aparecem a partir do início; datas antigas valem o dia inteiro", () => {
  const nova = { id: "c1", datasComHorario: true, dataInicio: { seconds: H("2026-11-27T10:00:00-03:00") / 1000 }, dataFim: { seconds: H("2026-12-20T18:00:00-03:00") / 1000 } };
  const antiga = { id: "c2", dataInicio: { seconds: H("2026-11-20T12:00:00-03:00") / 1000 }, dataFim: { seconds: H("2026-12-20T12:00:00-03:00") / 1000 } };
  const loja = regrasDaLoja({ colecoes: [nova, antiga] });
  assert.equal(srv.colecaoAindaNaoComecou(nova, H("2026-11-27T09:59:00-03:00")), true);
  assert.equal(srv.colecaoAindaNaoComecou(nova, H("2026-11-27T10:00:00-03:00")), false);
  assert.equal(loja.colecaoAindaNaoComecou(nova, H("2026-11-27T09:59:00-03:00")), true);
  assert.equal(srv.colecaoAindaNaoComecou(antiga, H("2026-11-20T00:01:00-03:00")), false, "data antiga: começa às 00:00");
  assert.equal(srv.colecaoJaTerminou(antiga, H("2026-12-20T23:00:00-03:00")), false, "data antiga: termina às 23:59");
  assert.equal(srv.colecaoJaTerminou(nova, H("2026-12-20T18:01:00-03:00")), true);
  assert.equal(loja.inicioDaColecao(antiga), srv.inicioDaColecao(antiga));
  const pecas = [{ id: "a", colecaoId: "c1", desconto: 0 }, { id: "b", colecaoId: "", desconto: 0 }];
  assert.deepEqual(loja.aplicarRegrasDeTempo(pecas, H("2026-11-26T12:00:00-03:00")).map((p) => p.id), ["b"], "antes do lançamento a peça some");
  assert.deepEqual(loja.aplicarRegrasDeTempo(pecas, H("2026-11-27T10:01:00-03:00")).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(regrasDaLoja({ admin: true, colecoes: [nova] }).aplicarRegrasDeTempo(pecas, H("2026-11-26T12:00:00-03:00")).map((p) => p.id), ["a", "b"], "administração vê antes");
});

test("página própria da peça: script de preço é válido e respeita o prazo", () => {
  const fields = parseFirestoreFields({ nome: { stringValue: "Toalha" }, preco: { integerValue: "100" }, desconto: { integerValue: "10" }, descontoAte: { stringValue: "2020-01-01T00:00:00Z" }, status: { stringValue: "active" }, categoria: { stringValue: "toalha_de_mesa" } });
  const product = normalizeProduct("abcdef123", fields);
  assert.equal(product.discount, 0, "prazo vencido no build: preço cheio");
  const html = renderProductPage(product);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code), "script da página com erro de sintaxe");
});

test("servidor de pedidos: cobra sem desconto vencido e recusa peça não lançada", async () => {
  const { buildCanonicalCartSnapshot } = await import("../server/_orders.mjs");
  const futuro = new Date(Date.now() + 86400000);
  const dados = {
    pecas: {
      vencida: { nome: "Toalha", preco: 100, desconto: 20, descontoAte: "2020-01-01T00:00:00Z", status: "active", categoria: "toalha_de_mesa", cores: [] },
      valendo: { nome: "Guardanapo", preco: 50, desconto: 10, descontoAte: futuro.toISOString(), status: "active", categoria: "guardanapo", cores: [] },
      lancamento: { nome: "Almofada", preco: 80, desconto: 0, status: "active", categoria: "capa_de_almofada", colecaoId: "colNova", cores: [] }
    },
    colecoes: { colNova: { nome: "Nova", ativa: true, datasComHorario: true, dataInicio: futuro } },
    site_config: { store_operations: { discountSchedules: [] } }
  };
  const db = { collection: (c) => ({ doc: (id) => ({ get: async () => ({ id, exists: Boolean(dados[c]?.[id]), data: () => dados[c]?.[id] }) }) }) };
  const item = (id, nome) => ({ cartId: `${id}-1`, id, nome, preco: 1, quantity: 1, tamanho: "Unico" });
  const carrinho = await buildCanonicalCartSnapshot(db, [item("vencida", "Toalha"), item("valendo", "Guardanapo")]);
  assert.equal(carrinho[0].preco, 100, "desconto vencido não é cobrado");
  assert.equal(carrinho[1].preco, 45, "desconto dentro do prazo continua");
  await assert.rejects(buildCanonicalCartSnapshot(db, [item("lancamento", "Almofada")]), /ainda não foi lançada/);
});
