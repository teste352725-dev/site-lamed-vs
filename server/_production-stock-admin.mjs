import { FieldValue, getAdminAuth, getAdminDb } from "./_firebase-admin.mjs";
import { isAdminDecodedToken } from "./_session.mjs";

const NUMBER_FIELDS = new Set(["estoque", "quantidade", "stock", "produzir", "producao", "production", "estoqueMinimo", "minimo", "minStock"]);
const ALLOWED_FIELDS = new Set([...NUMBER_FIELDS, "cores", "fichaTecnica"]);
const PRODUCTION_STAGES = new Set(["cut", "embroidering", "sewing", "ironing", "folding", "ready"]);
function stockError(status, message) { const error = new Error(message); error.status = status; return error; }
function safeNumber(value) { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000000) throw stockError(400, "Quantidade invalida."); return parsed; }
function cleanText(value, max = 120) { return String(value || "").trim().slice(0, max); }
function sanitizeColors(value) { if (!Array.isArray(value) || value.length > 100) throw stockError(400, "Lista de cores invalida."); return value.map((color) => ({ nome: cleanText(color?.nome, 80), hex: /^#[0-9a-f]{6}$/i.test(String(color?.hex || "")) ? color.hex : "#000000", quantidade: safeNumber(color?.quantidade ?? color?.estoque ?? 0), produzir: safeNumber(color?.produzir ?? color?.producao ?? 0) })).filter((color) => color.nome); }
function sanitizeTechSheet(value) { if (!Array.isArray(value) || value.length > 100) throw stockError(400, "Ficha tecnica invalida."); return value.map((item) => ({ tipo: cleanText(item?.tipo, 30), nome: cleanText(item?.nome || item?.item, 120), item: cleanText(item?.item || item?.nome, 120), numeracaoLinha: cleanText(item?.numeracaoLinha, 60), metragem: safeNumber(item?.metragem ?? item?.qty ?? 0), qty: safeNumber(item?.qty ?? item?.metragem ?? 0), unidade: cleanText(item?.unidade || "m", 12), unit: cleanText(item?.unit || "m", 12), estoque: safeNumber(item?.estoque ?? item?.disponivel ?? 0), disponivel: safeNumber(item?.disponivel ?? item?.estoque ?? 0) })).filter((item) => item.nome); }
function sanitizePayload(candidate) { if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw stockError(400, "Alteracao invalida."); const output = {}; for (const [key, value] of Object.entries(candidate)) { if (!ALLOWED_FIELDS.has(key)) continue; if (NUMBER_FIELDS.has(key)) output[key] = safeNumber(value); else if (key === "cores") output.cores = sanitizeColors(value); else if (key === "fichaTecnica") output.fichaTecnica = sanitizeTechSheet(value); } if (!Object.keys(output).length) throw stockError(400, "Nenhuma alteracao de producao foi informada."); return output; }

export async function applyProductionStockUpdate({ payload: requestPayload, user }) {
  if (!isAdminDecodedToken(user) && user?.production !== true) throw stockError(403, "Esta conta nao possui acesso a producao.");
  const account = await getAdminAuth().getUser(user.uid);
  if (account.disabled) throw stockError(403, "Este acesso foi bloqueado pela administracao.");
  const productId = cleanText(requestPayload?.productId, 160);
  const description = cleanText(requestPayload?.description || "Estoque atualizado", 240);
  const payload = sanitizePayload(requestPayload?.payload);
  if (!productId || productId.includes("/")) throw stockError(400, "Peca invalida.");
  const db = getAdminDb();
  const ref = db.collection("pecas").doc(productId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw stockError(404, "Peca nao encontrada.");
    const existing = Array.isArray(snapshot.data()?.historicoEstoque) ? snapshot.data().historicoEstoque.slice(-79) : [];
    existing.push({ descricao: description, createdAt: new Date().toISOString(), userId: user.uid, userName: user.name || user.email || "Equipe de producao" });
    transaction.update(ref, { ...payload, historicoEstoque: existing, updatedAt: FieldValue.serverTimestamp() });
  });
  return {};
}

async function requireProductionAccount(user) {
  if (!isAdminDecodedToken(user) && user?.production !== true) throw stockError(403, "Esta conta nao possui acesso a producao.");
  const account = await getAdminAuth().getUser(user.uid);
  if (account.disabled) throw stockError(403, "Este acesso foi bloqueado pela administracao.");
}

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

async function productionSnapshot() {
  const db = getAdminDb();
  const [recordsSnap, movementsSnap] = await Promise.all([
    db.collection("production_inventory").orderBy("updatedAt", "desc").limit(300).get(),
    db.collection("production_movements").orderBy("createdAt", "desc").limit(20).get()
  ]);
  return {
    records: recordsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), updatedAt: timestampIso(doc.data().updatedAt) })),
    movements: movementsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: timestampIso(doc.data().createdAt) }))
  };
}

async function moveProduction({ payload, user }) {
  const productId = cleanText(payload?.productId, 160);
  const stage = cleanText(payload?.stage, 30);
  const quantity = safeNumber(payload?.quantity);
  if (!productId || productId.includes("/")) throw stockError(400, "Peca invalida.");
  if (!PRODUCTION_STAGES.has(stage)) throw stockError(400, "Etapa de producao invalida.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw stockError(400, "A quantidade deve ficar entre 1 e 1000.");

  const db = getAdminDb();
  const productRef = db.collection("pecas").doc(productId);
  const inventoryRef = db.collection("production_inventory").doc(productId);
  const movementRef = db.collection("production_movements").doc();
  let result;
  await db.runTransaction(async (transaction) => {
    const [productSnap, inventorySnap] = await Promise.all([transaction.get(productRef), transaction.get(inventoryRef)]);
    if (!productSnap.exists) throw stockError(404, "Peca nao encontrada.");
    const product = productSnap.data() || {};
    const inventory = inventorySnap.exists ? inventorySnap.data() : {};
    const stageCounts = { ...(inventory.stageCounts || {}) };
    const previousStage = PRODUCTION_STAGES.has(inventory.currentStage) ? inventory.currentStage : null;
    if (previousStage && previousStage !== stage) {
      stageCounts[previousStage] = Math.max(0, Number(stageCounts[previousStage] || 0) - quantity);
    }
    stageCounts[stage] = Number(stageCounts[stage] || 0) + quantity;
    const record = {
      productId,
      productName: cleanText(product.nome || "Peca", 160),
      productCode: cleanText(product.codigo || product.sku || product.ref || productId, 100),
      image: cleanText((Array.isArray(product.imagens) && product.imagens[0]) || product.imagem || "", 2000),
      currentStage: stage,
      stageCounts,
      totalMovements: Number(inventory.totalMovements || 0) + quantity,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      updatedByName: cleanText(user.name || user.email || "Equipe de producao", 120)
    };
    const movement = {
      productId,
      productName: record.productName,
      productCode: record.productCode,
      image: record.image,
      stage,
      fromStage: previousStage,
      quantity,
      createdAt: FieldValue.serverTimestamp(),
      userId: user.uid,
      userName: record.updatedByName
    };
    transaction.set(inventoryRef, record, { merge: true });
    transaction.set(movementRef, movement);
    result = { ...record, updatedAt: new Date().toISOString() };
  });
  return { record: result };
}

export async function applyProductionStockAction({ action, payload, user }) {
  await requireProductionAccount(user);
  if (action === "stock.update") return applyProductionStockUpdate({ payload, user });
  if (action === "snapshot") return productionSnapshot();
  if (action === "move") return moveProduction({ payload, user });
  throw stockError(404, "Acao de producao nao encontrada.");
}
