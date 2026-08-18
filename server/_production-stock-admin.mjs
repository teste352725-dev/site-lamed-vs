import { FieldValue, getAdminAuth, getAdminDb } from "./_firebase-admin.mjs";
import { isAdminDecodedToken } from "./_session.mjs";

const NUMBER_FIELDS = new Set(["estoque", "quantidade", "stock", "produzir", "producao", "production", "estoqueMinimo", "minimo", "minStock"]);
const ALLOWED_FIELDS = new Set([...NUMBER_FIELDS, "cores", "fichaTecnica"]);
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
