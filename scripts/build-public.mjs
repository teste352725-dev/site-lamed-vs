import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(projectRoot, "public");
const rootAssets = new Set([
  "app.js",
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
const publicDirectories = ["css", "js"];

if (!outputDirectory.endsWith("/public")) {
  throw new Error("Diretorio de saida publico invalido.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const rootEntries = await readdir(projectRoot);
const htmlFiles = rootEntries.filter((name) => name.toLowerCase().endsWith(".html"));
const filesToCopy = [...rootAssets, ...htmlFiles];

for (const name of filesToCopy) {
  const source = join(projectRoot, name);
  if (!(await stat(source)).isFile()) throw new Error(`Arquivo publico invalido: ${name}`);
  await cp(source, join(outputDirectory, name));
}

for (const name of publicDirectories) {
  await cp(join(projectRoot, name), join(outputDirectory, name), { recursive: true });
}

console.log(`Pacote publico criado com ${filesToCopy.length} arquivos raiz e ${publicDirectories.length} diretorios.`);
