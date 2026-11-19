// Contador de visitas próprio, anônimo e sem cookie.
// Guarda só números por dia (horário de Brasília): visitas, peças vistas e cliques
// para o WhatsApp. Nada identifica a pessoa (sem IP, sem identificador salvo).
import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

export const EVENT_TYPES = new Set(["visita", "produto", "whatsapp"]);
export const WHATSAPP_ORIGINS = new Set(["produto", "pagina-produto", "checkout", "flutuante", "rodape", "outro"]);
const PRODUCT_ID = /^[A-Za-z0-9]{6,40}$/;
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|headless|lighthouse|pagespeed|vercel|curl|wget|python|node-fetch|axios/i;
const CATALOG_TTL_MS = 10 * 60 * 1000;

let catalogCache = { ids: null, loadedAt: 0 };

export function dayKey(date = new Date()) {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function isBot(userAgent) {
  const ua = String(userAgent || "");
  return !ua || BOT_UA.test(ua);
}

/** Valida o evento recebido do navegador. Retorna null se deve ser ignorado. */
export function parseEvent(body) {
  const t = String(body?.t || "");
  if (!EVENT_TYPES.has(t)) return null;
  const id = String(body?.id || "");
  if (t === "produto" && !PRODUCT_ID.test(id)) return null;
  const event = { t, id: PRODUCT_ID.test(id) ? id : "" };
  if (t === "whatsapp") event.o = WHATSAPP_ORIGINS.has(body?.o) ? body.o : "outro";
  return event;
}

/** Converte o evento em incrementos para o documento do dia. */
export function incrementsFor(event, increment = (n) => n) {
  if (event.t === "visita") return { visitas: increment(1) };
  if (event.t === "produto") return { produtos: { [event.id]: increment(1) } };
  const out = { whatsapp: increment(1), whatsappOrigem: { [event.o]: increment(1) } };
  if (event.id) out.whatsappProdutos = { [event.id]: increment(1) };
  return out;
}

async function knownProductIds(db) {
  if (catalogCache.ids && Date.now() - catalogCache.loadedAt < CATALOG_TTL_MS) return catalogCache.ids;
  const snap = await db.collection("pecas").select().get();
  catalogCache = { ids: new Set(snap.docs.map((d) => d.id)), loadedAt: Date.now() };
  return catalogCache.ids;
}

export async function recordEvent(body, { userAgent } = {}) {
  if (isBot(userAgent)) return { gravado: false, motivo: "robo" };
  const event = parseEvent(body);
  if (!event) return { gravado: false, motivo: "invalido" };
  const db = getAdminDb();
  if (event.id) {
    // Só ids que existem no catálogo: o documento do dia não incha com lixo.
    const ids = await knownProductIds(db);
    if (!ids.has(event.id)) {
      if (event.t === "produto") return { gravado: false, motivo: "peca" };
      event.id = "";
    }
  }
  await db.collection("estatisticas_dia").doc(dayKey()).set(
    { ...incrementsFor(event, (n) => FieldValue.increment(n)), atualizadoEm: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { gravado: true };
}

function topEntries(maps, limit = 5) {
  const totals = new Map();
  for (const map of maps) {
    for (const [id, n] of Object.entries(map || {})) totals.set(id, (totals.get(id) || 0) + (Number(n) || 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, total]) => ({ id, total }));
}

/** Junta os últimos N dias (lista de documentos já lidos) num resumo para a tela. */
export function buildSummary(docsByDay, days, today = new Date()) {
  const serie = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
    const d = docsByDay.get(key) || {};
    serie.push({ dia: key, visitas: Number(d.visitas) || 0, whatsapp: Number(d.whatsapp) || 0 });
  }
  const docs = [...docsByDay.values()];
  const hoje = serie[serie.length - 1];
  return {
    hoje: { visitas: hoje.visitas, whatsapp: hoje.whatsapp },
    periodo: {
      dias: days,
      visitas: serie.reduce((s, d) => s + d.visitas, 0),
      whatsapp: serie.reduce((s, d) => s + d.whatsapp, 0)
    },
    serie,
    maisVistas: topEntries(docs.map((d) => d.produtos)),
    maisWhatsapp: topEntries(docs.map((d) => d.whatsappProdutos)),
    origemWhatsapp: Object.fromEntries(topEntries(docs.map((d) => d.whatsappOrigem), 10).map((e) => [e.id, e.total]))
  };
}

export async function summarizeAnalytics({ days = 7, today = new Date() } = {}) {
  const db = getAdminDb();
  const keys = [];
  for (let i = days - 1; i >= 0; i -= 1) keys.push(dayKey(new Date(today.getTime() - i * 24 * 60 * 60 * 1000)));
  const snaps = await db.getAll(...keys.map((k) => db.collection("estatisticas_dia").doc(k)));
  const byDay = new Map();
  snaps.forEach((snap) => { if (snap.exists) byDay.set(snap.id, snap.data()); });
  return buildSummary(byDay, days, today);
}
