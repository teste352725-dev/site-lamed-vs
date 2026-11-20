// Vitrine de cada categoria (roupas = "moda", "mesa" ou "casa").
// Fonte: editor de categorias (colecoes/__catalog_settings -> categorias[].vitrine).
// Sem definição, valem as listas fixas abaixo (mesmas da loja: js/app-core.js).
const MESA_CATEGORIES = new Set(["mesa_posta", "lugar_americano", "guardanapo", "caminho_mesa", "toalha_de_mesa", "toalha_mesa", "anel_guardanapo", "porta_guardanapo", "trilho_velas", "capa_de_matza"]);
const CASA_CATEGORIES = new Set(["casa", "decoracao", "decoracao_casa", "almofada", "capa_almofada", "capa_de_almofada", "estandarte", "travesseiro", "capa_travesseiro", "capa_de_travesseiro", "cobertor", "manta"]);
const CACHE_MS = 60 * 1000;
let cache = { at: 0, map: null };

const semAcento = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function normalizeVitrine(value) {
  const word = semAcento(value);
  if (["moda", "roupa", "roupas"].includes(word)) return "moda";
  if (["mesa", "mesa posta", "mesa_posta"].includes(word)) return "mesa";
  if (["casa", "decoracao", "decoracao de casa", "decoracao_casa", "home", "lar"].includes(word)) return "casa";
  return "";
}

export function vitrinesFromSettings(categorias) {
  const map = new Map();
  (Array.isArray(categorias) ? categorias : []).forEach((entry) => {
    const vitrine = normalizeVitrine(entry?.vitrine);
    const slug = String(entry?.slug || "").trim();
    if (slug && vitrine) map.set(slug, vitrine);
  });
  return map;
}

// Vitrine pela categoria: configurada no editor ou, sem isso, pelas listas fixas.
export function vitrineDaCategoria(categoria, vitrines = null) {
  const slug = String(categoria || "").trim();
  const configured = vitrines?.get?.(slug);
  if (configured) return configured;
  const key = semAcento(slug);
  if (CASA_CATEGORIES.has(key)) return "casa";
  if (MESA_CATEGORIES.has(key)) return "mesa";
  return "moda";
}

export async function loadCategoryVitrines(db) {
  if (cache.map && Date.now() - cache.at < CACHE_MS) return cache.map;
  try {
    const snap = await db.collection("colecoes").doc("__catalog_settings").get();
    cache = { at: Date.now(), map: vitrinesFromSettings(snap.exists ? snap.data()?.categorias : []) };
  } catch (error) {
    cache = { at: Date.now(), map: cache.map || new Map() };
  }
  return cache.map;
}
