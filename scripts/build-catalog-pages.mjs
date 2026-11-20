// Gera, no momento do build, uma pagina estatica por produto ativo
// (/produto/<slug>/) e um sitemap.xml completo. Objetivo: SEO.
//
// - Le o catalogo publico (colecao `pecas`, mesma leitura anonima que a vitrine ja faz).
// - Nunca derruba o deploy: se o Firestore nao responder, gera so o sitemap basico.
// - O preco exibido segue a regra canonica do servidor (preco - desconto da peca)
//   e e atualizado ao vivo no navegador, porque a automacao diaria muda descontos
//   sem novo deploy.
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCatalogUnitPriceCents, centsToMoney } from "../server/_checkout-finance.mjs";
import { buildImageVariants, variantPath, OG_WIDTH } from "./build-images.mjs";

export const SITE_URL = "https://www.lamedvs.com.br";
export const FIREBASE_PROJECT_ID = "site-lamed";
// Chave Web publica do Firebase, lida do proprio js/app-core.js para nunca divergir.
// Nao e segredo: o acesso aos dados e controlado pelas regras do Firestore.
export const FIREBASE_WEB_API_KEY = readWebApiKey();

function readWebApiKey() {
  try {
    const source = readFileSync(new URL("../js/app-core.js", import.meta.url), "utf8");
    return source.match(/apiKey:\s*["']([^"']+)["']/)?.[1] || "";
  } catch {
    return "";
  }
}

export const STATIC_PAGES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/atendimento.html", changefreq: "monthly", priority: "0.5" },
  { path: "/entregas.html", changefreq: "monthly", priority: "0.5" },
  { path: "/trocas-e-devolucoes.html", changefreq: "monthly", priority: "0.4" },
  { path: "/politica-de-privacidade.html", changefreq: "yearly", priority: "0.3" },
  { path: "/termos-de-uso.html", changefreq: "yearly", priority: "0.3" }
];

const CATEGORY_LABELS = {
  vestido: "Vestidos",
  conjunto: "Conjuntos",
  calca: "Calças",
  camisa: "Camisas",
  saia: "Saias",
  blusa: "Blusas",
  mesa_posta: "Mesa Posta",
  lugar_americano: "Lugar Americano",
  guardanapo: "Guardanapos",
  anel_guardanapo: "Anel de Guardanapo",
  porta_guardanapo: "Porta-guardanapo",
  trilho_velas: "Trilho para Velas",
  caminho_mesa: "Caminho de Mesa",
  toalha_de_mesa: "Toalha de Mesa",
  capa_de_matza: "Capa de Matzá Bordada",
  combo: "Combos e Kits"
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Converte o formato tipado da API REST do Firestore em objetos JS simples.
export function parseFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(parseFirestoreValue);
  if ("mapValue" in value) return parseFirestoreFields(value.mapValue.fields || {});
  return null;
}

export function parseFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, parseFirestoreValue(value)]));
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "") || "peca";
}

export function productSlug(product) {
  return `${slugify(product.nome)}-${String(product.id || "").slice(0, 6).toLowerCase()}`;
}

export function productPath(product) {
  return `/produto/${productSlug(product)}/`;
}

function safeImageUrls(images) {
  return (Array.isArray(images) ? images : [])
    .map((item) => (typeof item === "string" ? item : item?.url))
    .filter((url) => typeof url === "string" && /^https:\/\//i.test(url))
    .slice(0, 8);
}

function formatBRL(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function normalizeProduct(id, data) {
  const listPrice = Number(data?.preco) || 0;
  const discount = Math.max(0, Math.min(100, Number(data?.desconto) || 0));
  const finalPrice = centsToMoney(getCatalogUnitPriceCents({ preco: listPrice, desconto: discount }));
  return {
    id,
    nome: String(data?.nome || "").trim(),
    subtitulo: String(data?.subtitulo || "").trim().replace(/\s+/g, " ").slice(0, 80),
    descricao: String(data?.descricao || "").trim(),
    categoria: String(data?.categoria || "").trim(),
    colecaoId: String(data?.colecaoId || "").trim(),
    status: String(data?.status || "").trim(),
    imagens: safeImageUrls(data?.imagens),
    cores: (Array.isArray(data?.cores) ? data.cores : [])
      .map((cor) => String(cor?.nome || "").trim())
      .filter(Boolean)
      .slice(0, 20),
    personalizavel: data?.personalizavel === true,
    listPrice,
    discount,
    finalPrice,
    updatedAt: data?.updatedAt || data?.createdAt || null
  };
}

export function isPublishable(product) {
  return product.status === "active" && product.nome && product.finalPrice > 0;
}

export function buildDescription(product) {
  if (product.descricao) return product.descricao.replace(/\s+/g, " ").slice(0, 300);
  const category = CATEGORY_LABELS[product.categoria] || "Peça";
  return `${product.nome}. ${category} Laméd vs, peça artesanal produzida sob encomenda no ateliê em Vitória - ES.`;
}

export function buildProductJsonLd(product) {
  const url = `${SITE_URL}${productPath(product)}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.nome,
    description: buildDescription(product),
    sku: product.id,
    brand: { "@type": "Brand", name: "Laméd vs" },
    url,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "BRL",
      price: product.finalPrice.toFixed(2),
      availability: "https://schema.org/MadeToOrder",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "Laméd vs" }
    }
  };
  if (product.imagens.length) data.image = product.imagens;
  if (CATEGORY_LABELS[product.categoria]) data.category = CATEGORY_LABELS[product.categoria];
  // Evita fechar a tag <script> por engano dentro do JSON.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// Troca a foto original (ate 14 MB) pela versao WebP gerada no build, quando existir.
export function optimizedImage(url, width, imageManifest, ext = "webp") {
  const key = imageManifest?.items?.[url];
  return key ? variantPath(key, width, ext) : url;
}

// Texto da prévia do link: preço e subtítulo primeiro, como nas lojas grandes.
export function buildShareDescription(product) {
  const partes = [];
  if (product.finalPrice > 0) {
    partes.push(product.discount > 0 && product.listPrice > product.finalPrice
      ? `De ${formatBRL(product.listPrice)} por ${formatBRL(product.finalPrice)}`
      : formatBRL(product.finalPrice));
  }
  if (product.subtitulo) partes.push(product.subtitulo);
  partes.push(buildDescription(product));
  return partes.join(" · ").slice(0, 200);
}

export function renderProductPage(product, imageManifest = null, fallbackShareImage = "") {
  const path = productPath(product);
  const url = `${SITE_URL}${path}`;
  const category = CATEGORY_LABELS[product.categoria] || "";
  const description = buildDescription(product);
  const shareDescription = buildShareDescription(product);
  const title = `${product.nome} | Laméd vs`;
  const shareTitle = product.subtitulo ? `${product.nome} (${product.subtitulo}) | Laméd vs` : title;
  const buyHref = `/#/produto/${encodeURIComponent(product.id)}`;
  const mainImage = product.imagens[0] || "";
  const mainImageKey = imageManifest?.items?.[mainImage];
  // Sem foto da peça: banner da coleção ou a foto da loja, para a prévia nunca ficar sem imagem.
  const shareImage = mainImageKey ? `${SITE_URL}${variantPath(mainImageKey, OG_WIDTH, "jpg")}` : (mainImage || fallbackShareImage || `${SITE_URL}/assets/hero-lamed.jpg`);
  const hasDiscount = product.discount > 0 && product.listPrice > product.finalPrice;
  // Mantem as quebras de linha que a proprietaria digitou no cadastro.
  const descriptionHtml = (product.descricao || description)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split(/\n/).map((line) => escapeHtml(line.trim())).join("<br>")}</p>`)
    .join("\n          ");

  const thumbs = product.imagens.slice(1).map((src, index) => `
          <img src="${escapeHtml(optimizedImage(src, 480, imageManifest))}" data-original-src="${escapeHtml(src)}" alt="${escapeHtml(product.nome)} - foto ${index + 2}" loading="lazy" decoding="async" width="160" height="200">`).join("");

  const colors = product.cores.length
    ? `<p class="produto-meta"><strong>Cores disponíveis:</strong> ${product.cores.map(escapeHtml).join(", ")}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description.slice(0, 160))}">
  <link rel="canonical" href="${escapeHtml(url)}">
  <meta property="og:type" content="product">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:site_name" content="Laméd vs">
  <meta property="og:title" content="${escapeHtml(shareTitle)}">
  <meta property="og:description" content="${escapeHtml(shareDescription)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${escapeHtml(shareImage)}">
  <meta property="og:image:alt" content="${escapeHtml(product.nome)}">
  <meta property="product:price:amount" content="${product.finalPrice.toFixed(2)}">
  <meta property="product:price:currency" content="BRL">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#FDFBF6">
  <link rel="icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://firebasestorage.googleapis.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Allura&family=Cormorant+Garamond:wght@500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/institucional.css?v=20261103">
  <link rel="stylesheet" href="/css/produto.css?v=20261120">
  <script type="application/ld+json" id="produto-jsonld">${buildProductJsonLd(product)}</script>
</head>
<body>
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  <header class="inst-header">
    <div class="inst-header__inner">
      <a class="inst-logo" href="/" aria-label="Laméd vs - página inicial">
        <span class="inst-logo__name">Laméd</span><span class="inst-logo__vs">vs</span>
      </a>
      <a class="inst-back" href="/#loja">Ver a loja</a>
    </div>
  </header>

  <main id="conteudo" class="produto-main" data-product-id="${escapeHtml(product.id)}">
    <nav class="produto-breadcrumb" aria-label="Você está em">
      <a href="/">Início</a> <span aria-hidden="true">/</span>
      <a href="/#loja">Loja</a>${category ? ` <span aria-hidden="true">/</span>
      <a href="/#/categoria/${escapeHtml(product.categoria)}">${escapeHtml(category)}</a>` : ""}
    </nav>

    <div class="produto-grid">
      <div class="produto-galeria">
        ${mainImage
          ? `<img class="produto-foto" src="${escapeHtml(optimizedImage(mainImage, 1080, imageManifest))}" data-original-src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.nome)}" width="800" height="1000" fetchpriority="high" decoding="async">`
          : `<div class="produto-foto produto-foto--vazia" aria-hidden="true"></div>`}
        ${thumbs ? `<div class="produto-miniaturas">${thumbs}
        </div>` : ""}
      </div>

      <div class="produto-info">
        ${category ? `<p class="inst-eyebrow">${escapeHtml(category)}</p>` : ""}
        <h1>${escapeHtml(product.nome)}</h1>
        <p class="produto-subtitulo" data-subtitulo${product.subtitulo ? "" : " hidden"}>${escapeHtml(product.subtitulo)}</p>
        <p class="produto-preco" aria-live="polite">
          <span class="produto-preco__antigo" data-preco-antigo${hasDiscount ? "" : " hidden"}>${escapeHtml(formatBRL(product.listPrice))}</span>
          <span class="produto-preco__atual" data-preco-atual>${escapeHtml(formatBRL(product.finalPrice))}</span>
        </p>
        <p class="produto-indisponivel" data-indisponivel hidden>Esta peça não está disponível no momento. Fale com o ateliê para saber quando volta.</p>

        <a class="inst-cta produto-cta" data-comprar href="${escapeHtml(buyHref)}">Escolher opções e comprar</a>
        <button type="button" class="produto-compartilhar" data-share-product data-share-url="${escapeHtml(url)}" data-share-name="${escapeHtml(product.nome)}">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg>
          <span data-share-label>Compartilhar esta peça</span>
        </button>

        <div class="produto-descricao">
          ${descriptionHtml}
        </div>
        ${colors}
        ${product.personalizavel ? `<p class="produto-meta"><strong>Personalização:</strong> esta peça pode ser personalizada. Você escolhe os detalhes ao comprar.</p>` : ""}

        <ul class="produto-garantias">
          <li><strong>Produção artesanal:</strong> prazo de 40 dias úteis após a confirmação do pedido. <!-- inst:inicio --><a href="/entregas.html">Ver entregas</a><!-- inst:fim --></li>
          <li><strong>Pagamento:</strong> Pix ou cartão pela InfinitePay. O frete é cobrado à parte, com o valor confirmado pelo WhatsApp.</li>
          <li><strong>Arrependimento:</strong> até 7 dias após o recebimento. <!-- inst:inicio --><a href="/trocas-e-devolucoes.html">Trocas e devoluções</a><!-- inst:fim --></li>
        </ul>

        <a class="produto-whats" href="https://wa.me/5527999287657?text=${encodeURIComponent(`Olá! Tenho interesse na peça "${product.nome}" (${url})`)}" target="_blank" rel="noopener noreferrer">Tirar dúvidas pelo WhatsApp</a>
      </div>
    </div>
  </main>

  <footer class="inst-footer">
    <div class="inst-footer__inner">
      <!-- inst:inicio -->
      <div>
        <h2>Institucional</h2>
        <ul>
          <li><a href="/atendimento.html">Atendimento</a></li>
          <li><a href="/entregas.html">Entregas e prazos</a></li>
          <li><a href="/trocas-e-devolucoes.html">Trocas e devoluções</a></li>
          <li><a href="/politica-de-privacidade.html">Política de privacidade</a></li>
          <li><a href="/termos-de-uso.html">Termos de uso</a></li>
        </ul>
      </div>
      <!-- inst:fim -->
      <div>
        <h2>Contato</h2>
        <ul>
          <li><a href="https://wa.me/5527999287657" target="_blank" rel="noopener noreferrer">WhatsApp (27) 99928-7657</a></li>
          <li><a href="mailto:veronicaateliercursos@gmail.com">veronicaateliercursos@gmail.com</a></li>
        </ul>
      </div>
    </div>
    <p class="inst-footer__legal">Laméd vs · Veronica Soares da Silva · CNPJ 43.698.381/0001-37 · &copy; 2026</p>
  </footer>

  <script defer src="/js/metricas.js?v=20261119"></script>
  <script defer src="/js/compartilhar.js?v=20261119"></script>
  <script>
  // Atualiza nome, preco e disponibilidade ao vivo (equipe/descontos mudam sem novo deploy).
  (function () {
    var main = document.getElementById('conteudo');
    var id = main && main.getAttribute('data-product-id');
    if (!id || !window.fetch) return;
    var url = 'https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pecas/' +
      encodeURIComponent(id) + '?key=${FIREBASE_WEB_API_KEY}';
    function num(field) { return field ? Number(field.integerValue || field.doubleValue || 0) : 0; }
    function brl(value) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    fetch(url).then(function (response) {
      if (response.status === 404) return { missing: true };
      return response.ok ? response.json() : null;
    }).then(function (doc) {
      if (!doc) return;
      var fields = doc.fields || {};
      var status = fields.status && fields.status.stringValue;
      if (doc.missing || status !== 'active') {
        document.querySelector('[data-indisponivel]').hidden = false;
        var buy = document.querySelector('[data-comprar]');
        buy.textContent = 'Ver outras peças';
        buy.setAttribute('href', '/#loja');
        return;
      }
      var liveName = fields.nome && fields.nome.stringValue;
      var h1 = document.querySelector('.produto-info h1');
      if (liveName && h1 && h1.textContent !== liveName) {
        h1.textContent = liveName;
        document.title = liveName + ' | Laméd vs';
      }
      var sub = document.querySelector('[data-subtitulo]');
      var liveSub = fields.subtitulo && fields.subtitulo.stringValue;
      if (sub) { sub.textContent = liveSub || ''; sub.hidden = !liveSub; }
      var list = num(fields.preco);
      var discount = Math.max(0, Math.min(100, num(fields.desconto)));
      if (!(list > 0)) return;
      var listCents = Math.round((list + Number.EPSILON) * 100);
      var finalValue = Math.round(listCents * (10000 - Math.round(discount * 100)) / 10000) / 100;
      document.querySelector('[data-preco-atual]').textContent = brl(finalValue);
      var old = document.querySelector('[data-preco-antigo]');
      old.textContent = brl(list);
      old.hidden = !(discount > 0 && finalValue < list);
      var ld = document.getElementById('produto-jsonld');
      try {
        var data = JSON.parse(ld.textContent);
        data.offers.price = finalValue.toFixed(2);
        ld.textContent = JSON.stringify(data).replace(/</g, '\\\\u003c');
      } catch (error) {}
    }).catch(function () {});
  })();
  </script>
</body>
</html>
`;
}

export function buildSitemap(products = [], today = new Date().toISOString().slice(0, 10), hiddenPaths = new Set()) {
  const urls = [
    ...STATIC_PAGES.filter((page) => !hiddenPaths.has(page.path)).map((page) => ({ loc: `${SITE_URL}${page.path}`, changefreq: page.changefreq, priority: page.priority, lastmod: today })),
    ...products.map((product) => ({
      loc: `${SITE_URL}${productPath(product)}`,
      changefreq: "weekly",
      priority: "0.8",
      lastmod: String(product.updatedAt || today).slice(0, 10)
    }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((entry) => `  <url>
    <loc>${escapeHtml(entry.loc)}</loc>
    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
}

export async function fetchCatalog({ fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const products = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pecas`);
    url.searchParams.set("pageSize", "300");
    if (FIREBASE_WEB_API_KEY) url.searchParams.set("key", FIREBASE_WEB_API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let payload;
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Firestore respondeu ${response.status}`);
      payload = await response.json();
    } finally {
      clearTimeout(timer);
    }
    for (const doc of payload.documents || []) {
      const id = String(doc.name || "").split("/").pop();
      products.push(normalizeProduct(id, parseFirestoreFields(doc.fields || {})));
    }
    pageToken = payload.nextPageToken || "";
    if (!pageToken) break;
  }
  return products;
}

// Coleções visíveis no site (com id), para as páginas de compartilhamento.
export async function fetchCollections({ fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/colecoes`);
  url.searchParams.set("pageSize", "100");
  if (FIREBASE_WEB_API_KEY) url.searchParams.set("key", FIREBASE_WEB_API_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Firestore respondeu ${response.status}`);
    const payload = await response.json();
    return (payload.documents || [])
      .map((doc) => normalizeCollection(String(doc.name || "").split("/").pop(), parseFirestoreFields(doc.fields || {})))
      .filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeCollection(id, data) {
  if (!id || id === "__catalog_settings" || data?.kind === "catalog_settings") return null;
  const nome = String(data?.nome || "").trim();
  if (!nome) return null;
  const imagem = typeof data?.imagemDestaque === "string" && /^https:\/\//i.test(data.imagemDestaque) ? data.imagemDestaque : "";
  return {
    id,
    nome,
    slug: slugify(data?.slug || nome),
    descricao: String(data?.descricao || "").replace(/\s+/g, " ").trim(),
    chamada: String(data?.chamadaHome || "").replace(/\s+/g, " ").trim(),
    imagem,
    publica: data?.ativa === true && data?.status !== "ended" && data?.status !== "inactive"
  };
}

export function collectionPath(collection) {
  return `/colecao/${collection.slug}/`;
}

// Página leve só para a prévia do link (WhatsApp, Instagram...): quem abre vai direto para a coleção na loja.
export function renderCollectionSharePage(collection, imageManifest = null) {
  const url = `${SITE_URL}${collectionPath(collection)}`;
  const target = `/#/colecao/${encodeURIComponent(collection.id)}`;
  const key = imageManifest?.items?.[collection.imagem];
  const image = key ? `${SITE_URL}${variantPath(key, OG_WIDTH, "jpg")}` : (collection.imagem || `${SITE_URL}/assets/hero-lamed.jpg`);
  const title = `Coleção ${collection.nome} | Laméd vs`;
  const description = (collection.chamada || collection.descricao || `Conheça as peças da coleção ${collection.nome}, feitas à mão no ateliê Laméd vs.`).slice(0, 200);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description.slice(0, 160))}">
  <link rel="canonical" href="${escapeHtml(url)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:site_name" content="Laméd vs">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:alt" content="${escapeHtml(`Coleção ${collection.nome}`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#FDFBF6">
  <link rel="icon" href="/favicon.ico">
  <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
  <script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family:Georgia,serif;background:#FDFBF6;color:#45301F;text-align:center;padding:3rem 1rem">
  <h1>${escapeHtml(`Coleção ${collection.nome}`)}</h1>
  <p>${escapeHtml(description)}</p>
  <p><a href="${escapeHtml(target)}" style="color:#643F21">Ver a coleção na loja</a></p>
</body>
</html>
`;
}

export async function fetchCollectionImages({ fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/colecoes`);
  url.searchParams.set("pageSize", "100");
  if (FIREBASE_WEB_API_KEY) url.searchParams.set("key", FIREBASE_WEB_API_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Firestore respondeu ${response.status}`);
    const payload = await response.json();
    return (payload.documents || [])
      .map((doc) => parseFirestoreFields(doc.fields || {}))
      .filter((data) => data.status !== "ended" && data.status !== "inactive")
      .map((data) => data.imagemDestaque)
      .filter((value) => typeof value === "string" && /^https:\/\//i.test(value));
  } finally {
    clearTimeout(timer);
  }
}

export async function buildCatalogPages(outputDirectory, { fetchImpl = fetch, log = console, imageOptions = {}, hiddenPaths = new Set() } = {}) {
  let products = [];
  try {
    products = (await fetchCatalog({ fetchImpl })).filter(isPublishable);
  } catch (error) {
    log.warn(`[catalogo] Nao foi possivel ler o catalogo (${error.message}). Gerando apenas o sitemap basico.`);
  }

  let collections = [];
  try {
    collections = await fetchCollections({ fetchImpl });
  } catch (error) {
    log.warn(`[colecoes] Colecoes nao lidas (${error.message}).`);
  }

  let imageManifest = null;
  if (imageOptions.enabled !== false) {
    const collectionImages = collections.filter((c) => c.publica && c.imagem).map((c) => c.imagem);
    const productImages = products.flatMap((product) => product.imagens);
    const ogUrls = new Set([...products.map((product) => product.imagens[0]), ...collectionImages].filter(Boolean));
    try {
      ({ manifest: imageManifest } = await buildImageVariants([...productImages, ...collectionImages], {
        outputDirectory,
        ogUrls,
        fetchImpl,
        log,
        ...imageOptions
      }));
    } catch (error) {
      log.warn(`[imagens] Otimizacao interrompida (${error.message}); o site usara as fotos originais.`);
    }
  }

  const collectionById = new Map(collections.map((c) => [c.id, c]));
  const collectionShareImage = (id) => {
    const c = collectionById.get(id);
    if (!c?.imagem) return "";
    const key = imageManifest?.items?.[c.imagem];
    return key ? `${SITE_URL}${variantPath(key, OG_WIDTH, "jpg")}` : c.imagem;
  };

  const usedSlugs = new Set();
  const published = [];
  for (const product of products) {
    const slug = productSlug(product);
    if (usedSlugs.has(slug)) continue;
    usedSlugs.add(slug);
    const directory = join(outputDirectory, "produto", slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), renderProductPage(product, imageManifest, collectionShareImage(product.colecaoId)), "utf8");
    published.push(product);
  }

  // Lista id -> endereco da pagina propria, usada pelo botao "Compartilhar" da loja.
  const links = Object.fromEntries(published.filter((product) => product.id).map((product) => [product.id, productPath(product)]));
  await mkdir(join(outputDirectory, "produto"), { recursive: true });
  await writeFile(join(outputDirectory, "produto", "links.json"), JSON.stringify(links), "utf8");

  // Páginas de compartilhamento das coleções (/colecao/<nome>/) e a lista id -> endereço.
  const collectionLinks = {};
  const usedCollectionSlugs = new Set();
  for (const collection of collections.filter((c) => c.publica)) {
    if (usedCollectionSlugs.has(collection.slug)) continue;
    usedCollectionSlugs.add(collection.slug);
    const directory = join(outputDirectory, "colecao", collection.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.html"), renderCollectionSharePage(collection, imageManifest), "utf8");
    collectionLinks[collection.id] = collectionPath(collection);
  }
  await mkdir(join(outputDirectory, "colecao"), { recursive: true });
  await writeFile(join(outputDirectory, "colecao", "links.json"), JSON.stringify(collectionLinks), "utf8");
  await writeFile(join(outputDirectory, "sitemap.xml"), buildSitemap(published, undefined, hiddenPaths), "utf8");
  log.log(`[catalogo] ${published.length} paginas de produto geradas; sitemap com ${published.length + STATIC_PAGES.length - hiddenPaths.size} URLs.`);
  return published;
}
