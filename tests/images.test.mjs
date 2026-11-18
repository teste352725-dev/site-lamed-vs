import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { buildImageVariants, imageKey, isOptimizableUrl } from "../scripts/build-images.mjs";
import { normalizeProduct, renderProductPage } from "../scripts/build-catalog-pages.mjs";

const FOTO = "https://firebasestorage.googleapis.com/v0/b/site-lamed.firebasestorage.app/o/produtos%2Ffoto.jpg?alt=media&token=abc";
const QUEBRADA = "https://firebasestorage.googleapis.com/v0/b/site-lamed.firebasestorage.app/o/produtos%2Fquebrada.jpg?alt=media&token=def";
const silentLog = { log() {}, warn() {} };

async function fakeJpeg(width = 3000, height = 4000) {
  return sharp({ create: { width, height, channels: 3, background: "#a58a5c" } }).jpeg({ quality: 95 }).toBuffer();
}

test("so otimiza fotos do Firebase Storage em https", () => {
  assert.equal(isOptimizableUrl(FOTO), true);
  assert.equal(isOptimizableUrl("http://firebasestorage.googleapis.com/x"), false);
  assert.equal(isOptimizableUrl("https://exemplo.com/foto.jpg"), false);
  assert.equal(isOptimizableUrl("javascript:alert(1)"), false);
});

test("gera WebP em 480/1080, JPEG de compartilhamento e manifesto; falha vira foto original", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lamed-img-"));
  const cache = await mkdtemp(join(tmpdir(), "lamed-img-cache-"));
  try {
    const jpeg = await fakeJpeg();
    let downloads = 0;
    const fetchImpl = async (url) => {
      downloads += 1;
      if (String(url).includes("quebrada")) return new Response("x", { status: 404 });
      return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const { manifest, stats } = await buildImageVariants([FOTO, FOTO, QUEBRADA, "https://exemplo.com/a.jpg"], {
      outputDirectory: dir, cacheDirectory: cache, ogUrls: new Set([FOTO]), fetchImpl, log: silentLog
    });
    const key = imageKey(FOTO);
    assert.deepEqual(manifest.items, { [FOTO]: key });
    assert.equal(stats.failed, 1);
    const files = (await readdir(join(dir, "img", "p"))).sort();
    assert.deepEqual(files, [`${key}-1080.webp`, `${key}-1200.jpg`, `${key}-480.webp`]);
    const small = await sharp(join(dir, "img", "p", `${key}-480.webp`)).metadata();
    assert.equal(small.format, "webp");
    assert.equal(small.width, 480);
    const saved = JSON.parse(await readFile(join(dir, "img", "manifest.json"), "utf8"));
    assert.equal(saved.items[FOTO], key);

    // segundo build usa o cache: nao baixa a foto de novo
    const before = downloads;
    const dir2 = await mkdtemp(join(tmpdir(), "lamed-img-2-"));
    const second = await buildImageVariants([FOTO], { outputDirectory: dir2, cacheDirectory: cache, ogUrls: new Set([FOTO]), fetchImpl, log: silentLog });
    assert.equal(downloads, before);
    assert.equal(second.stats.cached, 1);
    await rm(dir2, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test("pagina do produto usa a versao leve e guarda a original como reserva", () => {
  const product = normalizeProduct("abc123", { nome: "Abigail", preco: 100, status: "active", imagens: [FOTO, QUEBRADA] });
  const key = imageKey(FOTO);
  const html = renderProductPage(product, { items: { [FOTO]: key } });
  assert.match(html, new RegExp(`class="produto-foto" src="/img/p/${key}-1080\\.webp" data-original-src="https://firebasestorage`));
  assert.match(html, new RegExp(`<meta property="og:image" content="https://www\\.lamedvs\\.com\\.br/img/p/${key}-1200\\.jpg">`));
  // foto sem versao leve continua com a URL original
  assert.match(html, /src="https:\/\/firebasestorage[^"]*quebrada/);
  // sem manifesto, nada muda
  assert.match(renderProductPage(product), /class="produto-foto" src="https:\/\/firebasestorage/);
});

test("vitrine: LamedImages troca pela versao leve e cai para a original sem manifesto", async () => {
  const source = readFileSync(new URL("../js/image-variants.js", import.meta.url), "utf8");
  const run = async (payload) => {
    const listeners = {};
    const context = {
      window: { setTimeout: (fn) => setTimeout(fn, 0) },
      document: { addEventListener: (type, fn) => { listeners[type] = fn; } },
      fetch: async () => ({ ok: !!payload, json: async () => payload })
    };
    vm.runInNewContext(source, context);
    await context.window.LamedImages.ready;
    return { images: context.window.LamedImages, listeners };
  };
  const key = imageKey(FOTO);
  const { images, listeners } = await run({ v: 1, widths: [480, 1080], items: { [FOTO]: key } });
  assert.equal(images.url(FOTO, 300), `img/p/${key}-480.webp`);
  assert.equal(images.url(FOTO, 2000), `img/p/${key}-1080.webp`);
  assert.equal(images.srcset(FOTO), `img/p/${key}-480.webp 480w, img/p/${key}-1080.webp 1080w`);
  assert.equal(images.url(QUEBRADA, 480), QUEBRADA);

  // imagem leve com erro volta para a original
  const attrs = { "data-original-src": FOTO, srcset: "x" };
  const img = { tagName: "IMG", src: "img/p/x.webp", getAttribute: (n) => attrs[n] ?? null, setAttribute: (n, v) => { attrs[n] = v; }, removeAttribute: (n) => { delete attrs[n]; } };
  listeners.error({ target: img });
  assert.equal(img.src, FOTO);
  assert.equal(attrs.srcset, undefined);

  const empty = await run(null);
  assert.equal(empty.images.url(FOTO, 480), FOTO);
  assert.equal(empty.images.has(FOTO), false);
});
