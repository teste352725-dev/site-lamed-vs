import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { productSegment } from "../server/_atelie.mjs";
import { isPecaSemTamanho } from "../server/_orders.mjs";

// Regras da vitrine (js/app-core.js) carregadas num contexto isolado.
function loadStorefrontRules(activeCollections = []) {
  const source = readFileSync(new URL("../js/app-core.js", import.meta.url), "utf8");
  const start = source.indexOf("const CATALOG_SEGMENT_STORAGE_KEY");
  const end = source.indexOf("function readSavedCatalogSegment");
  const helpers = [
    source.slice(source.indexOf("function stripAccents"), source.indexOf("}", source.indexOf("function stripAccents")) + 1),
    source.slice(source.indexOf("function checkIsMesaPosta"), source.indexOf("}", source.indexOf("function checkIsMesaPosta")) + 1)
  ].join("\n");
  const context = { activeCollections };
  vm.runInNewContext(`${helpers}\n${source.slice(start, end)}\nthis.api = { getProductSegment, isPecaSemTamanho, normalizeCatalogSegment, CATALOG_SEGMENTS, setCategoryVitrines, checkIsMesaPosta, checkIsCasa };`, context);
  return context.api;
}

test("vitrine: Casa pela vitrine da peça, pela categoria ou pela coleção", () => {
  const rules = loadStorefrontRules([
    { id: "colCasa", segmentos: ["casa"] },
    { id: "colMista", segmentos: ["casa", "mesa"] }
  ]);
  assert.equal(rules.getProductSegment({ segmento: "casa", categoria: "vestido" }), "casa");
  assert.equal(rules.getProductSegment({ categoria: "capa_de_almofada" }), "casa");
  assert.equal(rules.getProductSegment({ segmento: "moda", categoria: "estandarte" }), "casa");
  assert.equal(rules.getProductSegment({ segmento: "moda", categoria: "outros", colecaoId: "colCasa" }), "casa");
  // coleção mista não muda a vitrine da peça
  assert.equal(rules.getProductSegment({ categoria: "guardanapo", colecaoId: "colMista" }), "mesa");
  // Roupas e Mesa posta continuam como antes
  assert.equal(rules.getProductSegment({ categoria: "vestido" }), "moda");
  assert.equal(rules.getProductSegment({ segmento: "mesa", categoria: "vestido" }), "mesa");
  assert.equal(rules.getProductSegment({ categoria: "lugar_americano" }), "mesa");
  assert.equal(rules.normalizeCatalogSegment("casa"), "casa");
  assert.equal(rules.normalizeCatalogSegment("Decoração"), "casa");
  assert.equal(rules.normalizeCatalogSegment("roupas"), "moda");
  assert.equal(rules.normalizeCatalogSegment("qualquer"), "mesa");
  assert.equal(rules.CATALOG_SEGMENTS.casa.title, "Casa");
});

test("peça de Casa não pede tamanho de roupa (loja e servidor iguais)", () => {
  const rules = loadStorefrontRules();
  const casos = [
    [{ categoria: "capa_de_almofada" }, true],
    [{ categoria: "outros", segmento: "casa" }, true],
    [{ categoria: "guardanapo" }, true],
    [{ categoria: "vestido", segmento: "moda" }, false],
    [{ categoria: "camisa" }, false]
  ];
  for (const [produto, esperado] of casos) {
    assert.equal(rules.isPecaSemTamanho(produto), esperado, `loja: ${JSON.stringify(produto)}`);
    assert.equal(isPecaSemTamanho(produto), esperado, `servidor: ${JSON.stringify(produto)}`);
  }
});

test("Ateliê: filtro Casa", () => {
  assert.equal(productSegment({ categoria: "estandarte" }), "casa");
  assert.equal(productSegment({ segmento: "casa" }), "casa");
  assert.equal(productSegment({ categoria: "vestido", colecaoId: "c1" }, new Set(["c1"])), "casa");
  assert.equal(productSegment({ categoria: "guardanapo" }), "mesa");
  assert.equal(productSegment({ categoria: "vestido" }), "moda");
});

test("Toalha de mesa é mesa posta (vitrine, sem tamanho, Ateliê)", () => {
  const rules = loadStorefrontRules();
  assert.equal(rules.getProductSegment({ categoria: "toalha_de_mesa" }), "mesa");
  assert.equal(rules.isPecaSemTamanho({ categoria: "toalha_de_mesa", segmento: "mesa" }), true);
  assert.equal(isPecaSemTamanho({ categoria: "toalha_de_mesa" }), true);
  assert.equal(productSegment({ categoria: "toalha_de_mesa" }), "mesa");
});

test("vitrine definida no editor de categorias vale na loja, nos pedidos e no Ateliê", async () => {
  const { vitrinesFromSettings, vitrineDaCategoria } = await import("../server/_categorias.mjs");
  const categorias = [
    { slug: "sousplat", nome: "Sousplat", vitrine: "mesa" },
    { slug: "quadro", nome: "Quadro", vitrine: "casa" },
    { slug: "guardanapo", nome: "Guardanapo", vitrine: "casa" }, // trocou de vitrine
    { slug: "vestido", nome: "Vestidos" } // sem escolha: lista fixa
  ];
  const rules = loadStorefrontRules();
  rules.setCategoryVitrines(categorias);
  const vitrines = vitrinesFromSettings(categorias);
  const casos = [
    ["sousplat", "mesa", true],
    ["quadro", "casa", true],
    ["guardanapo", "casa", true],
    ["vestido", "moda", false],
    ["lugar_americano", "mesa", true]
  ];
  for (const [categoria, vitrine, semTamanho] of casos) {
    assert.equal(rules.getProductSegment({ categoria }), vitrine, `loja: ${categoria}`);
    assert.equal(vitrineDaCategoria(categoria, vitrines), vitrine, `servidor: ${categoria}`);
    assert.equal(rules.isPecaSemTamanho({ categoria }), semTamanho, `loja sem tamanho: ${categoria}`);
    assert.equal(isPecaSemTamanho({ categoria }, vitrines), semTamanho, `pedido sem tamanho: ${categoria}`);
    assert.equal(productSegment({ categoria }, null, vitrines), vitrine, `Ateliê: ${categoria}`);
  }
  // a vitrine escolhida na própria peça continua valendo
  assert.equal(rules.getProductSegment({ categoria: "sousplat", segmento: "moda" }), "moda");
});
