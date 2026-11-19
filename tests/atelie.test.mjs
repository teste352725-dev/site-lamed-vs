import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMovement, buildProductStockUpdate, capabilitiesFor, describeMovement, productSegment, readVariants, validateProductEdit
} from "../server/_atelie.mjs";
import { buildSummary, dayKey, incrementsFor, isBot, parseEvent } from "../server/_analytics.mjs";
import { claimsForRole } from "../server/_team-admin.mjs";

const produto = {
  nome: "Guardanapo Chama",
  estoque: 2,
  cores: [
    { nome: "Pérola", hex: "#fffcef", quantidade: 1, produzir: 5, imagem: "foto-perola.jpg" },
    { nome: "Areia", hex: "#e5d3b3", estoque: 1 } // campo antigo "estoque"
  ]
};

test("readVariants: uma variante por cor e leitura do campo antigo", () => {
  assert.deepEqual(readVariants(produto), [
    { cor: "Pérola", hex: "#fffcef", pronta: 1, produzir: 5 },
    { cor: "Areia", hex: "#e5d3b3", pronta: 1, produzir: 0 }
  ]);
  assert.deepEqual(readVariants({ estoque: 3, produzir: 2 }), [{ cor: "", hex: "", pronta: 3, produzir: 2 }]);
  assert.deepEqual(readVariants({}), [{ cor: "", hex: "", pronta: 0, produzir: 0 }]);
});

test("applyMovement: produzir, ficar pronta e vender", () => {
  const v = { pronta: 1, produzir: 5 };
  assert.deepEqual(applyMovement(v, { tipo: "produzir", quantidade: 3 }), { pronta: 1, produzir: 8 });
  assert.deepEqual(applyMovement(v, { tipo: "pronta", quantidade: 2 }), { pronta: 3, produzir: 3 });
  assert.deepEqual(applyMovement(v, { tipo: "venda", quantidade: 1 }), { pronta: 0, produzir: 5 });
  // pronta sem producao lancada: a peca existe, produzir nao fica negativo
  assert.deepEqual(applyMovement({ pronta: 0, produzir: 0 }, { tipo: "pronta", quantidade: 2 }), { pronta: 2, produzir: 0 });
});

test("applyMovement: venda sem peca pronta pede confirmacao (encomenda em producao)", () => {
  assert.throws(() => applyMovement({ pronta: 0, produzir: 2 }, { tipo: "venda", quantidade: 1 }), (e) => e.code === "SEM_PRONTA" && e.status === 409);
  assert.throws(() => applyMovement({ pronta: 0, produzir: 0 }, { tipo: "venda", quantidade: 1 }), (e) => e.code === "SEM_ESTOQUE");
  assert.deepEqual(applyMovement({ pronta: 0, produzir: 2 }, { tipo: "venda", quantidade: 1, origem: "producao" }), { pronta: 0, produzir: 1 });
  assert.throws(() => applyMovement({ pronta: 3, produzir: 0 }, { tipo: "venda", quantidade: 1, origem: "producao" }), (e) => e.code === "SEM_PRODUCAO");
});

test("applyMovement: quantidade e ajuste validados", () => {
  for (const quantidade of [0, -1, 1.5, "abc", 501]) {
    assert.throws(() => applyMovement({ pronta: 9, produzir: 9 }, { tipo: "produzir", quantidade }), (e) => e.code === "QUANTIDADE");
  }
  assert.deepEqual(applyMovement({ pronta: 9, produzir: 9 }, { tipo: "ajuste", pronta: 0, produzir: 4 }), { pronta: 0, produzir: 4 });
  assert.throws(() => applyMovement({ pronta: 1, produzir: 1 }, { tipo: "ajuste", pronta: -1, produzir: 0 }), (e) => e.code === "QUANTIDADE");
  assert.throws(() => applyMovement({ pronta: 1, produzir: 1 }, { tipo: "apagar", quantidade: 1 }), (e) => e.code === "TIPO");
});

test("buildProductStockUpdate: altera so a cor certa e preserva os outros campos", () => {
  const update = buildProductStockUpdate(produto, "Pérola", { pronta: 4, produzir: 2 });
  assert.equal(update.cores[0].imagem, "foto-perola.jpg");
  assert.equal(update.cores[0].hex, "#fffcef");
  assert.equal(update.cores[0].quantidade, 4);
  assert.equal(update.cores[0].produzir, 2);
  assert.deepEqual(update.cores[1], produto.cores[1]);
  assert.equal(update.estoque, 5, "total = soma das prontas");
  // cor com campo antigo: os dois ficam iguais
  const legacy = buildProductStockUpdate(produto, "Areia", { pronta: 0, produzir: 1 });
  assert.equal(legacy.cores[1].estoque, 0);
  assert.equal(legacy.cores[1].quantidade, 0);
  // peca sem cores usa os campos da propria peca
  assert.deepEqual(buildProductStockUpdate({ estoque: 1 }, "", { pronta: 2, produzir: 3 }), { estoque: 2, produzir: 3 });
  assert.throws(() => buildProductStockUpdate(produto, "Azul", { pronta: 1, produzir: 0 }), (e) => e.code === "COR");
  assert.throws(() => buildProductStockUpdate({ estoque: 1 }, "Azul", { pronta: 1, produzir: 0 }), (e) => e.code === "COR");
});

test("describeMovement: frases em portugues claro", () => {
  assert.equal(describeMovement({ tipo: "produzir", quantidade: 1, cor: "Pérola" }), "1 peça entrou em produção (Pérola)");
  assert.equal(describeMovement({ tipo: "pronta", quantidade: 3, cor: "" }), "3 peças ficaram prontas");
  assert.equal(describeMovement({ tipo: "venda", quantidade: 2, cor: "Areia", canal: "instagram" }), "Venda de 2 peças (Areia) pelo Instagram");
  assert.equal(describeMovement({ tipo: "venda", quantidade: 1, cor: "", origem: "producao", canal: "whatsapp" }), "Venda de 1 peça em produção pelo WhatsApp");
});

test("validateProductEdit: nome e preco", () => {
  assert.deepEqual(validateProductEdit({ nome: "  Toalha   Shabat  " }), { nome: "Toalha Shabat" });
  assert.deepEqual(validateProductEdit({ preco: "1.259,90" }), { preco: 1259.9 });
  assert.deepEqual(validateProductEdit({ preco: 89.999 }), { preco: 90 });
  assert.throws(() => validateProductEdit({ nome: "a" }), (e) => e.code === "NOME");
  assert.throws(() => validateProductEdit({ preco: "0" }), (e) => e.code === "PRECO");
  assert.throws(() => validateProductEdit({ preco: "abc" }), (e) => e.code === "PRECO");
  assert.throws(() => validateProductEdit({}), (e) => e.code === "VAZIO");
  assert.equal(Object.keys(validateProductEdit({ nome: "Toalha", status: "inactive", preco: 10 })).sort().join(), "nome,preco", "campos fora da lista sao ignorados");
});

test("permissoes: cada papel so faz o que deve", () => {
  const prod = capabilitiesFor({ uid: "a", ...claimsForRole("production") });
  assert.deepEqual([prod.estoque, prod.pecas, prod.visitas, prod.admin], [true, false, true, false]);
  const team = capabilitiesFor({ uid: "b", ...claimsForRole("team") });
  assert.deepEqual([team.estoque, team.pecas, team.visitas, team.admin], [true, true, true, false]);
  const admin = capabilitiesFor({ uid: "c", ...claimsForRole("admin") });
  assert.deepEqual([admin.estoque, admin.pecas, admin.visitas, admin.admin], [true, true, true, true]);
  const cliente = capabilitiesFor({ uid: "d" });
  assert.deepEqual([cliente.estoque, cliente.pecas, cliente.visitas], [false, false, false]);
  assert.equal(claimsForRole("qualquer").catalog, undefined);
});

test("analytics: eventos validados e robos ignorados", () => {
  assert.deepEqual(parseEvent({ t: "visita" }), { t: "visita", id: "" });
  assert.deepEqual(parseEvent({ t: "produto", id: "8kuGwWMgdpMjm6qsfD1G" }), { t: "produto", id: "8kuGwWMgdpMjm6qsfD1G" });
  assert.equal(parseEvent({ t: "produto", id: "../x" }), null);
  assert.equal(parseEvent({ t: "produto" }), null);
  assert.equal(parseEvent({ t: "apagar" }), null);
  assert.deepEqual(parseEvent({ t: "whatsapp", o: "inventado" }), { t: "whatsapp", id: "", o: "outro" });
  assert.equal(isBot("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile"), false);
  assert.equal(isBot("Googlebot/2.1"), true);
  assert.equal(isBot("WhatsApp/2.23"), true);
  assert.equal(isBot(""), true);
  assert.deepEqual(incrementsFor({ t: "whatsapp", id: "abcdef12", o: "produto" }), { whatsapp: 1, whatsappOrigem: { produto: 1 }, whatsappProdutos: { abcdef12: 1 } });
});

test("analytics: dia no horario de Brasilia e resumo de 7 dias", () => {
  assert.equal(dayKey(new Date("2026-11-20T02:30:00Z")), "2026-11-19", "23h30 em Brasilia ainda e o dia 19");
  const today = new Date("2026-11-19T15:00:00Z");
  const docs = new Map([
    ["2026-11-19", { visitas: 10, whatsapp: 2, produtos: { aaa111: 4, bbb222: 1 }, whatsappProdutos: { aaa111: 2 }, whatsappOrigem: { produto: 2 } }],
    ["2026-11-17", { visitas: 5, produtos: { bbb222: 6 } }],
    ["2026-11-01", { visitas: 999 }] // fora do periodo nao entra na serie
  ]);
  const s = buildSummary(new Map([...docs].filter(([k]) => k !== "2026-11-01")), 7, today);
  assert.deepEqual(s.hoje, { visitas: 10, whatsapp: 2 });
  assert.deepEqual(s.periodo, { dias: 7, visitas: 15, whatsapp: 2 });
  assert.equal(s.serie.length, 7);
  assert.equal(s.serie[0].dia, "2026-11-13");
  assert.deepEqual(s.maisVistas, [{ id: "bbb222", total: 7 }, { id: "aaa111", total: 4 }]);
  assert.deepEqual(s.maisWhatsapp, [{ id: "aaa111", total: 2 }]);
});

test("productSegment: mesma regra da vitrine", () => {
  assert.equal(productSegment({ segmento: "mesa", categoria: "vestido" }), "mesa");
  assert.equal(productSegment({ segmento: "Roupas" }), "moda");
  assert.equal(productSegment({ categoria: "guardanapo" }), "mesa");
  assert.equal(productSegment({ categoria: "camisa" }), "moda");
});
