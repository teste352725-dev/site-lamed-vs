// Gera versoes leves (WebP) das fotos do catalogo durante o build.
//
// Por que: as fotos enviadas pelo painel chegam com ate 8192x6144 px e 14 MB.
// A vitrine mostra no maximo ~1000 px. Aqui cada foto vira duas versoes WebP
// (cards/miniaturas e tela do produto) servidas pela propria Vercel, sem custo
// extra e sem alterar nada no Firebase. Se algo falhar, o site usa a foto
// original (o manifesto simplesmente nao lista aquela imagem).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const IMAGE_WIDTHS = [480, 1080];
export const OG_WIDTH = 1200;
export const IMAGE_PUBLIC_DIR = "img/p";
const WEBP_OPTIONS = { quality: 78, effort: 4 };
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export function imageKey(url) {
  return createHash("sha1").update(String(url)).digest("hex").slice(0, 16);
}

export function variantPath(key, width, ext = "webp") {
  return `/${IMAGE_PUBLIC_DIR}/${key}-${width}.${ext}`;
}

export function isOptimizableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "firebasestorage.googleapis.com";
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

async function download(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error("arquivo grande demais");
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string[]} urls fotos do catalogo
 * @param {object} options
 * @returns {Promise<{manifest: object, stats: object}>}
 */
export async function buildImageVariants(urls, {
  outputDirectory,
  cacheDirectory,
  ogUrls = new Set(),
  fetchImpl = fetch,
  log = console,
  concurrency = 4,
  timeoutMs = 60000,
  budgetMs = 8 * 60 * 1000,
  sharpImpl
} = {}) {
  const manifest = { v: 1, widths: IMAGE_WIDTHS, items: {} };
  const stats = { total: 0, generated: 0, cached: 0, failed: 0, skipped: 0, sourceBytes: 0, outputBytes: 0 };
  const sharp = sharpImpl || await loadSharp();
  if (!sharp) {
    log.warn("[imagens] Biblioteca sharp indisponivel; o site usara as fotos originais.");
    return { manifest, stats };
  }

  const unique = [...new Set(urls.filter(isOptimizableUrl))];
  stats.total = unique.length;
  const outDir = join(outputDirectory, IMAGE_PUBLIC_DIR);
  await mkdir(outDir, { recursive: true });
  if (cacheDirectory) await mkdir(cacheDirectory, { recursive: true });
  const startedAt = Date.now();

  const processOne = async (url) => {
    const key = imageKey(url);
    const wantsOg = ogUrls.has(url);
    const targets = IMAGE_WIDTHS.map((width) => ({ width, ext: "webp" }));
    if (wantsOg) targets.push({ width: OG_WIDTH, ext: "jpg" });
    const fileName = (t) => `${key}-${t.width}.${t.ext}`;

    // 1) cache do build anterior
    if (cacheDirectory) {
      const cachedAll = (await Promise.all(targets.map((t) => exists(join(cacheDirectory, fileName(t)))))).every(Boolean);
      if (cachedAll) {
        for (const t of targets) {
          const data = await readFile(join(cacheDirectory, fileName(t)));
          await writeFile(join(outDir, fileName(t)), data);
          stats.outputBytes += data.length;
        }
        manifest.items[url] = key;
        stats.cached += 1;
        return;
      }
    }

    if (Date.now() - startedAt > budgetMs) {
      stats.skipped += 1;
      return;
    }

    // 2) baixa e converte
    try {
      const source = await download(url, { fetchImpl, timeoutMs });
      stats.sourceBytes += source.length;
      for (const t of targets) {
        const pipeline = sharp(source, { failOn: "none", limitInputPixels: 80_000_000 })
          .rotate()
          .resize({ width: t.width, withoutEnlargement: true });
        const data = t.ext === "jpg"
          ? await pipeline.flatten({ background: "#FDFBF6" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer()
          : await pipeline.webp(WEBP_OPTIONS).toBuffer();
        await writeFile(join(outDir, fileName(t)), data);
        if (cacheDirectory) await writeFile(join(cacheDirectory, fileName(t)), data).catch(() => {});
        stats.outputBytes += data.length;
      }
      manifest.items[url] = key;
      stats.generated += 1;
    } catch (error) {
      stats.failed += 1;
      log.warn(`[imagens] Mantendo original (${error.message}): ${url.slice(0, 110)}`);
    }
  };

  const queue = unique.slice();
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) await processOne(queue.shift());
  });
  await Promise.all(workers);

  await writeFile(join(outputDirectory, "img", "manifest.json"), JSON.stringify(manifest), "utf8");
  log.log(`[imagens] ${Object.keys(manifest.items).length}/${stats.total} fotos otimizadas (novas: ${stats.generated}, cache: ${stats.cached}, falhas: ${stats.failed}, puladas: ${stats.skipped}); ${(stats.sourceBytes / 1e6).toFixed(1)} MB baixados -> ${(stats.outputBytes / 1e6).toFixed(1)} MB publicados em ${Math.round((Date.now() - startedAt) / 1000)} s.`);
  return { manifest, stats };
}
