import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { buildCatalogPages } from "./build-catalog-pages.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(projectRoot, "public");
// "app.js" (versao monolitica antiga, substituida por js/app-*.js) nao e mais
// publicado: nenhuma pagina o carrega. O arquivo segue no repositorio como referencia.
const rootAssets = new Set([
  "favicon.ico",
  "firebase-messaging-sw.js",
  "manifest.json",
  "offline.html",
  "robots.txt",
  "sitemap.xml",
  "styles.css",
  "sw.js",
  "user.js"
]);
const publicDirectories = ["assets", "css", "js"];
const productionExcludedHtml = new Set(["teste-frete.html"]);

if (!outputDirectory.endsWith("/public")) {
  throw new Error("Diretorio de saida publico invalido.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const rootEntries = await readdir(projectRoot);
const isProductionBuild = String(process.env.VERCEL_ENV || "").trim().toLowerCase() === "production";
const allHtmlFiles = rootEntries.filter((name) => name.toLowerCase().endsWith(".html"));

// Paginas juridicas ainda em rascunho (aviso data-rascunho ou trechos "A DEFINIR")
// so aparecem na previa. Em producao saem do pacote, junto com os links para elas
// (blocos entre <!-- inst:inicio --> e <!-- inst:fim -->), ate a proprietaria aprovar.
const pendingPages = [];
const draftHtml = new Set();
for (const name of allHtmlFiles) {
  const html = await readFile(join(projectRoot, name), "utf8");
  const count = (html.match(/class="pendente"/g) || []).length;
  if (count > 0 || html.includes("data-rascunho")) {
    pendingPages.push(`${name} (${count} pendencia(s))`);
    draftHtml.add(name);
  }
}
const hideDrafts = draftHtml.size > 0 && (isProductionBuild || process.env.LAMED_HIDE_DRAFTS === "1");

const htmlFiles = allHtmlFiles.filter((name) => (
  !(isProductionBuild && productionExcludedHtml.has(name)) &&
  !(hideDrafts && draftHtml.has(name))
));
const filesToCopy = [...rootAssets, ...htmlFiles];

for (const name of filesToCopy) {
  const source = join(projectRoot, name);
  if (!(await stat(source)).isFile()) throw new Error(`Arquivo publico invalido: ${name}`);
  await cp(source, join(outputDirectory, name));
}

for (const name of publicDirectories) {
  await cp(join(projectRoot, name), join(outputDirectory, name), { recursive: true });
}

// Paginas de produto (/produto/<slug>/) + sitemap.xml completo. Nunca derruba o build.
await buildCatalogPages(outputDirectory, {
  hiddenPaths: hideDrafts ? new Set([...draftHtml].map((name) => `/${name}`)) : new Set(),
  imageOptions: {
    enabled: process.env.LAMED_SKIP_IMAGES !== "1",
    // A Vercel guarda node_modules entre builds: so fotos novas sao baixadas e convertidas.
    cacheDirectory: join(projectRoot, "node_modules", ".cache", "lamed-images")
  }
});

if (hideDrafts) {
  const removed = await stripInstitutionalLinks(outputDirectory);
  console.warn(`[revisao] Producao sem as paginas em rascunho (${[...draftHtml].join(", ")}); links removidos em ${removed} arquivo(s).`);
} else if (pendingPages.length) {
  console.warn(`[revisao] Paginas ainda em rascunho: ${pendingPages.join(", ")}.`);
}

console.log(`Pacote publico criado com ${filesToCopy.length} arquivos raiz e ${publicDirectories.length} diretorios.`);

async function stripInstitutionalLinks(directory) {
  let changed = 0;
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    const html = await readFile(path, "utf8");
    if (!html.includes("<!-- inst:inicio -->")) continue;
    const stripped = html
      .replace(/[ \t]*<!-- inst:inicio -->[\s\S]*?<!-- inst:fim -->\n?/g, "")
      .replace(/md:grid-cols-3( [^"]*") data-inst-grid/g, "md:grid-cols-2$1");
    if (stripped !== html) {
      await writeFile(path, stripped, "utf8");
      changed += 1;
    }
  }
  return changed;
}
