// Ateliê: área simples da equipe (estoque por cor, nome/preço das peças, visitas).
// Toda alteração passa por aqui; o servidor confere a permissão de cada ação.
import { vitrinesFromSettings } from "./_categorias.mjs";
import { FieldValue, getAdminAuth, getAdminDb } from "./_firebase-admin.mjs";
import { isAdminDecodedToken } from "./_session.mjs";
import { summarizeAnalytics } from "./_analytics.mjs";

export const UNDO_WINDOW_MS = 15 * 60 * 1000;
export const SALE_CHANNELS = new Set(["whatsapp", "instagram", "evento", "site", "outro"]);
const MOVEMENT_TYPES = new Set(["produzir", "pronta", "venda", "ajuste"]);
const MAX_QTY = 500;
const NO_COLOR = "";

export class AtelieError extends Error {
  constructor(status, message, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => { throw new AtelieError(status, message, code); };
const clean = (value, max = 120) => String(value ?? "").trim().slice(0, max);
const int = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

// ---------------------------------------------------------------- permissões

export function capabilitiesFor(user) {
  const admin = isAdminDecodedToken(user);
  return {
    admin,
    estoque: admin || user?.production === true,
    pecas: admin || user?.catalog === true,
    visitas: admin || user?.production === true || user?.catalog === true
  };
}

function requireCap(caps, key) {
  if (!caps[key]) fail(403, "Seu acesso não permite esta ação. Fale com a administração.");
}

// ---------------------------------------------------------------- estoque (puro)

/** Lê as variantes de estoque de uma peça: uma por cor, ou uma única sem cor. */
export function readVariants(product) {
  const colors = Array.isArray(product?.cores) ? product.cores.filter((c) => clean(c?.nome)) : [];
  if (!colors.length) {
    return [{ cor: NO_COLOR, hex: "", pronta: int(product?.estoque), produzir: int(product?.produzir) }];
  }
  return colors.map((c) => ({
    cor: clean(c.nome, 80),
    hex: /^#[0-9a-f]{6}$/i.test(String(c.hex || "")) ? c.hex : "",
    pronta: int(c.quantidade ?? c.estoque),
    produzir: int(c.produzir ?? c.producao)
  }));
}

/**
 * Calcula o efeito de um movimento numa variante.
 * Retorna { pronta, produzir } novos, ou lança erro com código para a tela orientar.
 */
export function applyMovement(variant, { tipo, quantidade, origem, pronta, produzir }) {
  const before = { pronta: int(variant.pronta), produzir: int(variant.produzir) };
  const qty = Number(quantidade);
  if (tipo !== "ajuste" && (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY)) {
    fail(400, `A quantidade deve ficar entre 1 e ${MAX_QTY}.`, "QUANTIDADE");
  }
  switch (tipo) {
    case "produzir":
      return { pronta: before.pronta, produzir: before.produzir + qty };
    case "pronta":
      // Se esqueceram de lançar a produção, a peça pronta existe mesmo assim.
      return { pronta: before.pronta + qty, produzir: Math.max(0, before.produzir - qty) };
    case "venda":
      if (origem === "producao") {
        if (before.produzir < qty) fail(409, "Não há peças suficientes em produção nesta cor.", "SEM_PRODUCAO");
        return { pronta: before.pronta, produzir: before.produzir - qty };
      }
      if (before.pronta < qty) {
        fail(409, before.produzir > 0
          ? "Não há peça pronta nesta cor. Foi uma peça que ainda está em produção?"
          : "Não há peça pronta nem em produção nesta cor.", before.produzir > 0 ? "SEM_PRONTA" : "SEM_ESTOQUE");
      }
      return { pronta: before.pronta - qty, produzir: before.produzir };
    case "ajuste": {
      const p = Number(pronta), q = Number(produzir);
      if (![p, q].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)) fail(400, "Informe números inteiros, de zero para cima.", "QUANTIDADE");
      return { pronta: p, produzir: q };
    }
    default:
      return fail(400, "Movimento de estoque inválido.", "TIPO");
  }
}

/** Monta a atualização da peça mantendo todos os outros campos de cada cor. */
export function buildProductStockUpdate(product, cor, next) {
  const colors = Array.isArray(product?.cores) ? product.cores : [];
  const hasColors = colors.some((c) => clean(c?.nome));
  if (!hasColors) {
    if (cor !== NO_COLOR) fail(404, "Esta peça não tem essa cor cadastrada.", "COR");
    return { estoque: next.pronta, produzir: next.produzir };
  }
  let found = false;
  const cores = colors.map((c) => {
    if (found || clean(c?.nome, 80) !== cor) return c;
    found = true;
    const updated = { ...c, quantidade: next.pronta, produzir: next.produzir };
    if ("estoque" in updated) updated.estoque = next.pronta; // campo antigo, mantido em sincronia
    if ("producao" in updated) updated.producao = next.produzir;
    return updated;
  });
  if (!found) fail(404, "Esta peça não tem essa cor cadastrada.", "COR");
  const estoque = cores.reduce((sum, c) => sum + (clean(c?.nome) ? int(c.quantidade ?? c.estoque) : 0), 0);
  return { cores, estoque };
}

export function describeMovement({ tipo, quantidade, cor, canal, origem }) {
  const q = Number(quantidade) || 0;
  const corTxt = cor ? ` (${cor})` : "";
  const plural = (s, p) => (q === 1 ? s : p);
  switch (tipo) {
    case "produzir": return `${q} ${plural("peça entrou", "peças entraram")} em produção${corTxt}`;
    case "pronta": return `${q} ${plural("peça ficou pronta", "peças ficaram prontas")}${corTxt}`;
    case "venda": return `Venda de ${q} ${plural("peça", "peças")}${corTxt}${origem === "producao" ? " em produção" : ""}${canal ? ` ${canalFrase(canal)}` : ""}`;
    case "ajuste": return `Contagem corrigida${corTxt}`;
    default: return "Estoque atualizado";
  }
}

export function canalFrase(canal) {
  return { whatsapp: "pelo WhatsApp", instagram: "pelo Instagram", evento: "em evento ou feira", site: "pelo site", outro: "por outro canal" }[canal] || "";
}

export function canalLabel(canal) {
  return { whatsapp: "WhatsApp", instagram: "Instagram", evento: "Evento/feira", site: "Site", outro: "Outro" }[canal] || "";
}

// ---------------------------------------------------------------- peças (puro)

export function validateProductEdit(input) {
  const out = {};
  if (input?.nome !== undefined) {
    const nome = clean(input.nome, 140).replace(/\s+/g, " ");
    if (nome.length < 2) fail(400, "O nome precisa ter pelo menos 2 letras.", "NOME");
    out.nome = nome;
  }
  if (input?.preco !== undefined) {
    const raw = typeof input.preco === "string" ? input.preco.replace(/\./g, "").replace(",", ".") : input.preco;
    const preco = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(preco) || preco <= 0 || preco > 100000) fail(400, "Informe um preço válido, maior que zero.", "PRECO");
    out.preco = preco;
  }
  if (!Object.keys(out).length) fail(400, "Nada para alterar.", "VAZIO");
  return out;
}

// ---------------------------------------------------------------- leitura

// Mesma regra da vitrine (js/app-core.js): sem segmento, decide pela categoria.
const MESA_CATEGORIES = new Set(["mesa_posta", "lugar_americano", "guardanapo", "caminho_mesa", "toalha_de_mesa", "toalha_mesa", "anel_guardanapo", "porta_guardanapo", "trilho_velas", "capa_de_matza"]);
const CASA_CATEGORIES = new Set(["casa", "decoracao", "decoracao_casa", "almofada", "capa_almofada", "capa_de_almofada", "estandarte", "travesseiro", "capa_travesseiro", "capa_de_travesseiro", "cobertor", "manta"]);
const CASA_WORDS = new Set(["casa", "decoracao", "decoracao de casa", "decoracao_casa", "home", "lar"]);
const semAcento = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// casaCollections: ids das coleções marcadas só como "Casa" (a peça entra em Casa por elas).
// vitrines: mapa categoria -> vitrine do editor de categorias.
export function productSegment(data, casaCollections = null, vitrines = null) {
  const seg = semAcento(clean(data?.segmento, 30)).toLowerCase();
  const categoria = semAcento(clean(data?.categoria, 60)).toLowerCase();
  const configured = vitrines?.get?.(clean(data?.categoria, 60));
  if (CASA_WORDS.has(seg) || configured === "casa" || (!configured && CASA_CATEGORIES.has(categoria)) || (casaCollections && casaCollections.has(data?.colecaoId))) return "casa";
  if (seg) return ["moda", "roupa", "roupas", "fashion"].includes(seg) ? "moda" : "mesa";
  if (configured) return configured;
  return MESA_CATEGORIES.has(clean(data?.categoria, 60).toLowerCase()) ? "mesa" : "moda";
}

function slimProduct(id, data, casaCollections = null, vitrines = null) {
  const imagens = Array.isArray(data.imagens) ? data.imagens : [];
  return {
    id,
    nome: clean(data.nome, 140),
    preco: Number(data.preco) || 0,
    desconto: Math.max(0, Math.min(100, Number(data.desconto) || 0)),
    segmento: productSegment(data, casaCollections, vitrines),
    categoria: clean(data.categoria, 60),
    status: clean(data.status, 20) || "active",
    imagem: clean(imagens[0] || data.imagem || "", 2000),
    variantes: readVariants(data)
  };
}

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return typeof value === "string" ? value : null;
}

function publicMovement(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    tipo: d.tipo,
    productId: d.productId,
    productName: d.productName,
    cor: d.cor || "",
    quantidade: d.quantidade || 0,
    canal: d.canal || "",
    descricao: d.descricao || "",
    userId: d.userId,
    userName: d.userName || "",
    createdAt: timestampIso(d.createdAt),
    desfeito: Boolean(d.desfeitoEm)
  };
}

async function accountName(user) {
  if (user?.name) return clean(user.name, 80);
  try {
    const account = await getAdminAuth().getUser(user.uid);
    return clean(account.displayName || account.email?.split("@")[0] || "Equipe", 80);
  } catch {
    return "Equipe";
  }
}

async function ensureActive(user) {
  const account = await getAdminAuth().getUser(user.uid);
  if (account.disabled) fail(403, "Este acesso foi bloqueado pela administração.");
  return account;
}

async function loadHome(user, caps) {
  const db = getAdminDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [pecasSnap, colecoesSnap, movSnap, analytics] = await Promise.all([
    db.collection("pecas").get(),
    db.collection("colecoes").get().catch(() => null),
    db.collection("estoque_movimentos").where("createdAt", ">=", since).orderBy("createdAt", "desc").limit(200).get(),
    caps.visitas ? summarizeAnalytics({ days: 7 }).catch(() => null) : null
  ]);
  const settingsDoc = (colecoesSnap?.docs || []).find((doc) => doc.id === "__catalog_settings");
  const vitrines = vitrinesFromSettings(settingsDoc?.data()?.categorias);
  const casaCollections = new Set((colecoesSnap?.docs || []).filter((doc) => {
    const c = doc.data() || {};
    const segs = Array.isArray(c.segmentos) ? c.segmentos : (c.segmento ? [c.segmento] : []);
    return segs.length > 0 && segs.every((x) => CASA_WORDS.has(semAcento(x).toLowerCase()));
  }).map((doc) => doc.id));
  const pecas = pecasSnap.docs.map((doc) => slimProduct(doc.id, doc.data() || {}, casaCollections, vitrines))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const movimentos = movSnap.docs.map(publicMovement);
  const vendasSemana = movimentos.filter((m) => m.tipo === "venda" && !m.desfeito)
    .reduce((sum, m) => sum + m.quantidade, 0);
  const names = new Map(pecas.map((p) => [p.id, p.nome]));
  if (analytics) {
    for (const list of [analytics.maisVistas, analytics.maisWhatsapp]) {
      for (const item of list) item.nome = names.get(item.id) || "Peça removida";
    }
  }
  return {
    me: { uid: user.uid, nome: await accountName(user), permissoes: caps },
    pecas,
    movimentos: movimentos.slice(0, 30),
    vendasSemana,
    visitas: analytics
  };
}

// ---------------------------------------------------------------- escrita

const MOVEMENT_ID = /^[A-Za-z0-9_-]{12,40}$/;

async function moveStock(user, payload) {
  const productId = clean(payload?.productId, 160);
  const cor = clean(payload?.cor, 80);
  const tipo = clean(payload?.tipo, 20);
  const movimentoId = clean(payload?.movimentoId, 40);
  const canal = SALE_CHANNELS.has(payload?.canal) ? payload.canal : "";
  const origem = payload?.origem === "producao" ? "producao" : "pronta";
  if (!productId || productId.includes("/")) fail(400, "Peça inválida.");
  if (!MOVEMENT_TYPES.has(tipo)) fail(400, "Movimento de estoque inválido.", "TIPO");
  if (!MOVEMENT_ID.test(movimentoId)) fail(400, "Identificador do movimento inválido.");

  const db = getAdminDb();
  const productRef = db.collection("pecas").doc(productId);
  const movementRef = db.collection("estoque_movimentos").doc(movimentoId);
  const userName = await accountName(user);
  let result;

  await db.runTransaction(async (tx) => {
    const [productSnap, movementSnap] = await Promise.all([tx.get(productRef), tx.get(movementRef)]);
    if (movementSnap.exists) {
      // Toque repetido ou reenvio pela rede: devolve o mesmo resultado, sem duplicar.
      const product = productSnap.exists ? slimProduct(productId, productSnap.data()) : null;
      result = { repetido: true, peca: product, movimento: publicMovement(movementSnap) };
      return;
    }
    if (!productSnap.exists) fail(404, "Peça não encontrada.");
    const product = productSnap.data() || {};
    const variant = readVariants(product).find((v) => v.cor === cor);
    if (!variant) fail(404, "Esta peça não tem essa cor cadastrada.", "COR");
    const next = applyMovement(variant, { tipo, quantidade: payload?.quantidade, origem, pronta: payload?.pronta, produzir: payload?.produzir });
    const update = buildProductStockUpdate(product, cor, next);
    const quantidade = tipo === "ajuste" ? Math.abs(next.pronta - variant.pronta) + Math.abs(next.produzir - variant.produzir) : Number(payload.quantidade);
    const descricao = describeMovement({ tipo, quantidade, cor, canal, origem });
    const historico = Array.isArray(product.historicoEstoque) ? product.historicoEstoque.slice(-79) : [];
    historico.push({ descricao, createdAt: new Date().toISOString(), userId: user.uid, userName });
    tx.update(productRef, { ...update, historicoEstoque: historico, updatedAt: FieldValue.serverTimestamp() });
    const movement = {
      tipo, productId, productName: clean(product.nome, 140), cor, quantidade, canal: tipo === "venda" ? canal : "",
      origem: tipo === "venda" ? origem : "", antes: { pronta: variant.pronta, produzir: variant.produzir }, depois: next,
      descricao, userId: user.uid, userName, createdAt: FieldValue.serverTimestamp()
    };
    tx.set(movementRef, movement);
    const merged = { ...product, ...update };
    result = {
      repetido: false,
      peca: slimProduct(productId, merged),
      movimento: { id: movimentoId, ...movement, createdAt: new Date().toISOString(), desfeito: false }
    };
  });
  return result;
}

async function undoMovement(user, caps, payload) {
  const movimentoId = clean(payload?.movimentoId, 40);
  if (!MOVEMENT_ID.test(movimentoId)) fail(400, "Movimento inválido.");
  const db = getAdminDb();
  const movementRef = db.collection("estoque_movimentos").doc(movimentoId);
  let result;
  await db.runTransaction(async (tx) => {
    const movementSnap = await tx.get(movementRef);
    if (!movementSnap.exists) fail(404, "Movimento não encontrado.");
    const m = movementSnap.data();
    if (m.desfeitoEm) fail(409, "Este movimento já foi desfeito.", "DESFEITO");
    if (m.userId !== user.uid && !caps.admin) fail(403, "Só quem fez o movimento pode desfazê-lo.");
    const created = m.createdAt?.toDate?.()?.getTime?.() || 0;
    if (!caps.admin && Date.now() - created > UNDO_WINDOW_MS) fail(409, "Passou o tempo para desfazer. Use \"Corrigir números\".", "PRAZO");
    const productRef = db.collection("pecas").doc(m.productId);
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists) fail(404, "Peça não encontrada.");
    const product = productSnap.data() || {};
    const variant = readVariants(product).find((v) => v.cor === (m.cor || ""));
    if (!variant) fail(404, "A cor deste movimento não existe mais.", "COR");
    // Desfaz pela diferença, para não apagar movimentos feitos depois por outra pessoa.
    const next = {
      pronta: variant.pronta - (m.depois.pronta - m.antes.pronta),
      produzir: variant.produzir - (m.depois.produzir - m.antes.produzir)
    };
    if (next.pronta < 0 || next.produzir < 0) fail(409, "Não dá para desfazer: o estoque já mudou depois. Use \"Corrigir números\".", "CONFLITO");
    const update = buildProductStockUpdate(product, m.cor || "", next);
    const userName = await accountName(user);
    const historico = Array.isArray(product.historicoEstoque) ? product.historicoEstoque.slice(-79) : [];
    historico.push({ descricao: `Desfeito: ${m.descricao}`, createdAt: new Date().toISOString(), userId: user.uid, userName });
    tx.update(productRef, { ...update, historicoEstoque: historico, updatedAt: FieldValue.serverTimestamp() });
    tx.update(movementRef, { desfeitoEm: FieldValue.serverTimestamp(), desfeitoPor: user.uid });
    result = { peca: slimProduct(m.productId, { ...product, ...update }) };
  });
  return result;
}

async function editProduct(user, payload) {
  const productId = clean(payload?.productId, 160);
  if (!productId || productId.includes("/")) fail(400, "Peça inválida.");
  const changes = validateProductEdit(payload);
  const db = getAdminDb();
  const ref = db.collection("pecas").doc(productId);
  const userName = await accountName(user);
  let result;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, "Peça não encontrada.");
    const product = snap.data() || {};
    const antes = {};
    for (const key of Object.keys(changes)) antes[key] = product[key] ?? null;
    tx.update(ref, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.collection("pecas_alteracoes").doc(), {
      productId, productName: clean(product.nome, 140), antes, depois: changes,
      userId: user.uid, userName, createdAt: FieldValue.serverTimestamp()
    });
    result = { peca: slimProduct(productId, { ...product, ...changes }) };
  });
  return result;
}

export async function applyAtelieAction({ action, payload, user }) {
  const caps = capabilitiesFor(user);
  if (!caps.estoque && !caps.pecas && !caps.visitas) fail(403, "Esta conta não tem acesso ao Ateliê.");
  await ensureActive(user);
  switch (action) {
    case "inicio":
      return loadHome(user, caps);
    case "estoque.mover":
      requireCap(caps, "estoque");
      return moveStock(user, payload);
    case "estoque.desfazer":
      requireCap(caps, "estoque");
      return undoMovement(user, caps, payload);
    case "peca.editar":
      requireCap(caps, "pecas");
      return editProduct(user, payload);
    default:
      return fail(404, "Ação não encontrada.");
  }
}
