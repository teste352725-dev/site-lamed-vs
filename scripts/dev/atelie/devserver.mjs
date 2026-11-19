// Servidor local: arquivos de public/ + funcoes de api/ ligadas aos EMULADORES.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

for (const k of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "GCLOUD_PROJECT"]) {
  if (!process.env[k]) { console.error(`Recusado: ${k} nao definido (protecao contra dados reais).`); process.exit(1); }
}
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const PUB = join(ROOT, "public");
const PORT = Number(process.env.PORT || 4180);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml" };
const ROUTES = { "/api/eventos": "api/status.mjs", "/api/status": "api/status.mjs", "/api/admin/storefront/update": "api/admin/storefront/update.mjs" };

function shimRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (ROUTES[url.pathname]) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    const ct = String(req.headers["content-type"] || "");
    req.body = ct.includes("application/json") ? (raw ? JSON.parse(raw) : {}) : raw;
    req.query = Object.fromEntries(url.searchParams);
    const mod = await import(pathToFileURL(join(ROOT, ROUTES[url.pathname])).href);
    try { await mod.default(req, shimRes(res)); } catch (e) { console.error(e); res.statusCode = 500; res.end("erro"); }
    return;
  }
  let path = url.pathname === "/atelie" ? "/atelie.html" : url.pathname;
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(PUB, decodeURIComponent(path)));
  if (!file.startsWith(PUB)) { res.statusCode = 403; return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.setHeader("content-type", TYPES[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end("404"); }
}).listen(PORT, "127.0.0.1", () => console.log(`devserver em http://127.0.0.1:${PORT}`));
