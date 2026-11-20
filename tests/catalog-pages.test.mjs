import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCollection, renderCollectionSharePage, collectionPath, buildShareDescription } from "../scripts/build-catalog-pages.mjs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FIREBASE_WEB_API_KEY,
  buildCatalogPages,
  buildProductJsonLd,
  buildSitemap,
  normalizeProduct,
  parseFirestoreFields,
  productPath,
  renderProductPage,
  slugify
} from "../scripts/build-catalog-pages.mjs";

const firestoreDoc = (id, fields) => ({ name: `projects/site-lamed/databases/(default)/documents/pecas/${id}`, fields });
const sampleFields = {
  nome: { stringValue: "Caminho de Mesa Shabat Shalom" },
  preco: { integerValue: "200" },
  desconto: { integerValue: "10" },
  status: { stringValue: "active" },
  categoria: { stringValue: "caminho_mesa" },
  descricao: { stringValue: "Linho bordado.\nFeito à mão." },
  imagens: { arrayValue: { values: [{ stringValue: "https://firebasestorage.googleapis.com/a.jpg" }, { stringValue: "javascript:alert(1)" }] } },
  cores: { arrayValue: { values: [{ mapValue: { fields: { nome: { stringValue: "Areia" }, hex: { stringValue: "#eee" } } } }] } }
};

test("chave web publica e lida do js/app-core.js", () => {
  assert.match(FIREBASE_WEB_API_KEY, /^AIza[0-9A-Za-z_-]{35}$/);
});

test("parseFirestoreFields converte tipos da API REST", () => {
  const parsed = parseFirestoreFields(sampleFields);
  assert.equal(parsed.preco, 200);
  assert.equal(parsed.cores[0].nome, "Areia");
  assert.equal(parsed.imagens.length, 2);
});

test("preco segue a regra canonica do servidor (preco - desconto)", () => {
  const product = normalizeProduct("abcdef123", parseFirestoreFields(sampleFields));
  assert.equal(product.finalPrice, 180);
  assert.equal(product.listPrice, 200);
});

test("imagens so aceitam https (bloqueia javascript:)", () => {
  const product = normalizeProduct("abcdef123", parseFirestoreFields(sampleFields));
  assert.deepEqual(product.imagens, ["https://firebasestorage.googleapis.com/a.jpg"]);
});

test("slug e caminho estaveis e sem acentos", () => {
  assert.equal(slugify("Capa de Matzá Bordada!"), "capa-de-matza-bordada");
  assert.equal(productPath({ id: "XyZ12345", nome: "Saia Ester" }), "/produto/saia-ester-xyz123/");
});

test("nome malicioso e escapado no HTML e no JSON-LD", () => {
  const evil = normalizeProduct("evil00", { nome: '</script><img src=x onerror=alert(1)>', preco: 10, status: "active" });
  const html = renderProductPage(evil);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(buildProductJsonLd(evil), /<\/script>/);
  assert.match(html, /&lt;\/script&gt;/);
});

test("pagina de produto tem canonical, dados estruturados, CTA de compra e quebras de linha", () => {
  const product = normalizeProduct("abcdef123", parseFirestoreFields(sampleFields));
  const html = renderProductPage(product);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.lamedvs\.com\.br\/produto\/caminho-de-mesa-shabat-shalom-abcdef\/">/);
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"price":"180\.00"/);
  assert.match(html, /href="\/#\/produto\/abcdef123"/);
  assert.match(html, /Linho bordado\.<br>Feito à mão\./);
  assert.doesNotMatch(html, /lamediverso/);
});

test("sitemap lista paginas institucionais e produtos", () => {
  const product = normalizeProduct("abcdef123", parseFirestoreFields(sampleFields));
  const xml = buildSitemap([product], "2026-11-03");
  assert.match(xml, /<loc>https:\/\/www\.lamedvs\.com\.br\/politica-de-privacidade\.html<\/loc>/);
  assert.match(xml, /<loc>https:\/\/www\.lamedvs\.com\.br\/produto\/caminho-de-mesa-shabat-shalom-abcdef\/<\/loc>/);
});

test("build gera so produtos ativos com preco e ignora duplicados", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lamed-catalogo-"));
  try {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ documents: [
        firestoreDoc("abcdef123", sampleFields),
        firestoreDoc("inativo1", { ...sampleFields, status: { stringValue: "inactive" } }),
        firestoreDoc("semPreco", { ...sampleFields, nome: { stringValue: "Outra" }, preco: { integerValue: "0" } })
      ] })
    });
    const published = await buildCatalogPages(dir, { fetchImpl: fakeFetch, log: { log() {}, warn() {} } });
    assert.equal(published.length, 1);
    assert.deepEqual((await readdir(join(dir, "produto"))).sort(), ["caminho-de-mesa-shabat-shalom-abcdef", "links.json"]);
    // lista usada pelo botao "Compartilhar" da loja
    assert.deepEqual(JSON.parse(await readFile(join(dir, "produto", "links.json"), "utf8")), { abcdef123: "/produto/caminho-de-mesa-shabat-shalom-abcdef/" });
    const pagina = await readFile(join(dir, "produto", "caminho-de-mesa-shabat-shalom-abcdef", "index.html"), "utf8");
    assert.match(pagina, /data-share-url="https:\/\/www\.lamedvs\.com\.br\/produto\/caminho-de-mesa-shabat-shalom-abcdef\/"/);
    assert.match(pagina, /\/js\/compartilhar\.js/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("se o Firestore falhar, o build continua e gera o sitemap basico", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lamed-catalogo-"));
  try {
    const warnings = [];
    const failingFetch = async () => { throw new Error("sem rede"); };
    const published = await buildCatalogPages(dir, { fetchImpl: failingFetch, log: { log() {}, warn: (m) => warnings.push(m) } });
    assert.equal(published.length, 0);
    assert.match(warnings[0], /Nao foi possivel ler o catalogo/);
    assert.ok(warnings.every((m) => /catalogo|Colecoes|imagens/.test(m)), warnings.join(" | "));
    assert.match(await readFile(join(dir, "sitemap.xml"), "utf8"), /termos-de-uso\.html/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pagina da peca mostra o subtitulo abaixo do nome", () => {
  const product = normalizeProduct("abcdef123", parseFirestoreFields({ ...sampleFields, subtitulo: { stringValue: "  Sem   enchimento " } }));
  assert.equal(product.subtitulo, "Sem enchimento");
  const html = renderProductPage(product);
  assert.match(html, /<h1>[^<]+<\/h1>\s*<p class="produto-subtitulo" data-subtitulo>Sem enchimento<\/p>/);
  const semSub = renderProductPage(normalizeProduct("abcdef123", parseFirestoreFields(sampleFields)));
  assert.match(semSub, /data-subtitulo hidden><\/p>/);
});

test("previa do link: colecao com banner, nome e chamada; abre a colecao na loja", () => {
  const c = normalizeCollection("dlSRnfNByPbtEtBpmAlJ", { nome: "Chanukah", ativa: true, status: "active", chamadaHome: "Prepare seu lar para a Festa das Luzes.", imagemDestaque: "https://firebasestorage.googleapis.com/x.jpg" });
  assert.equal(collectionPath(c), "/colecao/chanukah/");
  const html = renderCollectionSharePage(c);
  assert.match(html, /property="og:title" content="Coleção Chanukah \| Laméd vs"/);
  assert.match(html, /property="og:description" content="Prepare seu lar para a Festa das Luzes."/);
  assert.match(html, /property="og:image" content="https:\/\/firebasestorage.googleapis.com\/x.jpg"/);
  assert.match(html, /location.replace\("\/#\/colecao\/dlSRnfNByPbtEtBpmAlJ"\)/);
  assert.equal(normalizeCollection("x1", { nome: "Antiga", ativa: false, status: "ended" }).publica, false);
  assert.equal(normalizeCollection("__catalog_settings", { kind: "catalog_settings" }), null);
});

test("previa do link: peca mostra preco, subtitulo e nunca fica sem imagem", () => {
  const product = normalizeProduct("abcdef123", parseFirestoreFields({ ...sampleFields, subtitulo: { stringValue: "Sem enchimento" }, imagens: { arrayValue: {} } }));
  assert.match(buildShareDescription(product), /^(De )?R\$/);
  assert.match(buildShareDescription(product), /Sem enchimento/);
  const html = renderProductPage(product, null, "https://www.lamedvs.com.br/img/banner.jpg");
  assert.match(html, /property="og:image" content="https:\/\/www.lamedvs.com.br\/img\/banner.jpg"/);
  assert.match(html, /property="og:title" content="[^"]+\(Sem enchimento\) \| Laméd vs"/);
});
