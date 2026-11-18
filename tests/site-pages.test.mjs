import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

const INSTITUTIONAL = [
  "atendimento.html",
  "entregas.html",
  "trocas-e-devolucoes.html",
  "politica-de-privacidade.html",
  "termos-de-uso.html"
];

const INTERNAL_PAGES = [
  "dashboard.html", "produtos.html", "pedidos.html", "colecoes.html", "galeria.html", "chat-admin.html",
  "editor-imagem.html", "equipe.html", "estoque-mesaposta.html", "executor_scripts.html", "calculadora.html",
  "login-admin.html", "login-admin-google.html", "login-producao.html", "minha-conta.html", "offline.html"
];

test("paginas institucionais existem, usam o dominio oficial e sao indexaveis", () => {
  for (const page of INSTITUTIONAL) {
    const html = read(page);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www\\.lamedvs\\.com\\.br/${page.replace(".", "\\.")}">`), page);
    assert.doesNotMatch(html, /lamediverso/, page);
    assert.doesNotMatch(html, /name="robots" content="noindex/, page);
    assert.match(html, /<html lang="pt-BR">/, page);
  }
});

test("dados comerciais vem do site publicado/proprietaria (nada inventado)", () => {
  for (const page of INSTITUTIONAL) {
    const html = read(page);
    assert.match(html, /43\.698\.381\/0001-37/, page);
    assert.match(html, /\(27\) 99928-7657/, page);
  }
});

test("direito de arrependimento de 7 dias citado em trocas e no checkout", () => {
  assert.match(read("trocas-e-devolucoes.html"), /7 \(sete\) dias corridos a contar do recebimento/);
  assert.match(read("index.html"), /desistir da compra em até 7 dias/);
});

test("home linka as paginas institucionais no rodape e no checkout", () => {
  const index = read("index.html");
  for (const page of INSTITUTIONAL) assert.ok(index.includes(`href="${page}"`), `faltou link para ${page}`);
  assert.match(index, /class="checkout-legal-note/);
  assert.match(index, /<meta property="og:image"/);
});

test("paginas internas (admin, conta, producao) tem noindex", () => {
  for (const page of INTERNAL_PAGES) {
    assert.match(read(page), /<meta name="robots" content="noindex/, page);
  }
});

test("robots.txt nao bloqueia paginas com noindex e aponta o sitemap", () => {
  const robots = read("robots.txt");
  assert.match(robots, /Disallow: \/api\//);
  assert.doesNotMatch(robots, /Disallow: \/dashboard/);
  assert.match(robots, /Sitemap: https:\/\/www\.lamedvs\.com\.br\/sitemap\.xml/);
});

test("vercel.json envia X-Robots-Tag para paginas internas", () => {
  const config = JSON.parse(read("vercel.json"));
  const rule = config.headers.find((entry) => entry.headers.some((h) => h.key === "X-Robots-Tag"));
  assert.ok(rule);
  for (const page of ["dashboard", "pedidos", "minha-conta"]) {
    assert.match(`/${page}.html`, new RegExp(`^${rule.source}$`));
  }
  assert.doesNotMatch("/index.html", new RegExp(`^${rule.source}$`));
});

test("nenhuma pagina publica referencia o app.js legado", () => {
  for (const file of readdirSync(new URL(".", root)).filter((name) => name.endsWith(".html"))) {
    assert.doesNotMatch(read(file), /src="\/?app\.js/, file);
  }
});

test("saude do catalogo no dashboard conta pecas sem descricao/foto/preco", () => {
  const source = read("js/admin-dashboard.js");
  const fn = source.match(/function summarizeCatalogHealth\(products\) \{[\s\S]*?\n\}/)[0];
  const context = {};
  vm.runInNewContext(`${fn}; this.summarize = summarizeCatalogHealth;`, context);
  const health = context.summarize([
    { id: "1", status: "active", nome: "A", preco: 10, descricao: "ok", imagens: ["x", "y"] },
    { id: "2", status: "active", nome: "B", preco: 10, descricao: "", imagens: ["x"] },
    { id: "3", status: "active", nome: "C", preco: 0, descricao: "ok", imagens: [] },
    { id: "4", status: "inactive", nome: "D", preco: 10 }
  ]);
  assert.equal(health.active, 3);
  assert.equal(health.inactive, 1);
  assert.equal(health.withoutDescription.length, 1);
  assert.equal(health.singlePhoto.length, 1);
  assert.equal(health.withoutPhoto.length, 1);
  assert.equal(health.withoutPrice.length, 1);
});
