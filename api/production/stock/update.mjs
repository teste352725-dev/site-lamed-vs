import { FieldValue, getAdminAuth, getAdminDb } from "../../../server/_firebase-admin.mjs";
import { isAdminDecodedToken, isSessionRequestError, resolveAuthenticatedUser } from "../../../server/_session.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";

const NUMBER_FIELDS = new Set([
  "estoque", "quantidade", "stock", "produzir", "producao", "production",
  "estoqueMinimo", "minimo", "minStock"
]);
const ALLOWED_FIELDS = new Set([...NUMBER_FIELDS, "cores", "fichaTecnica"]);

function safeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000000) {
    throw new Error("Quantidade invalida.");
  }
  return parsed;
}

function cleanText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeColors(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Lista de cores invalida.");
  return value.map((color) => ({
    nome: cleanText(color?.nome, 80),
    hex: /^#[0-9a-f]{6}$/i.test(String(color?.hex || "")) ? color.hex : "#000000",
    quantidade: safeNumber(color?.quantidade ?? color?.estoque ?? 0),
    produzir: safeNumber(color?.produzir ?? color?.producao ?? 0)
  })).filter((color) => color.nome);
}

function sanitizeTechSheet(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Ficha tecnica invalida.");
  return value.map((item) => ({
    tipo: cleanText(item?.tipo, 30),
    nome: cleanText(item?.nome || item?.item, 120),
    item: cleanText(item?.item || item?.nome, 120),
    numeracaoLinha: cleanText(item?.numeracaoLinha, 60),
    metragem: safeNumber(item?.metragem ?? item?.qty ?? 0),
    qty: safeNumber(item?.qty ?? item?.metragem ?? 0),
    unidade: cleanText(item?.unidade || "m", 12),
    unit: cleanText(item?.unit || "m", 12),
    estoque: safeNumber(item?.estoque ?? item?.disponivel ?? 0),
    disponivel: safeNumber(item?.disponivel ?? item?.estoque ?? 0)
  })).filter((item) => item.nome);
}

function sanitizePayload(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Alteracao invalida.");
  const output = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    if (NUMBER_FIELDS.has(key)) output[key] = safeNumber(value);
    else if (key === "cores") output.cores = sanitizeColors(value);
    else if (key === "fichaTecnica") output.fichaTecnica = sanitizeTechSheet(value);
  }
  if (!Object.keys(output).length) throw new Error("Nenhuma alteracao de producao foi informada.");
  return output;
}

export default async function handler(req, res) {
  setNoStore(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const user = await resolveAuthenticatedUser(authorizationHeader);
    if (!isAdminDecodedToken(user) && user?.production !== true) {
      return res.status(403).json({ ok: false, error: "Esta conta nao possui acesso a producao." });
    }
    const account = await getAdminAuth().getUser(user.uid);
    if (account.disabled) return res.status(403).json({ ok: false, error: "Este acesso foi bloqueado pela administracao." });

    const body = getRequestBody(req);
    const productId = cleanText(body?.productId, 160);
    const description = cleanText(body?.description || "Estoque atualizado", 240);
    const payload = sanitizePayload(body?.payload);
    if (!productId || productId.includes("/")) return res.status(400).json({ ok: false, error: "Peca invalida." });

    const db = getAdminDb();
    const ref = db.collection("pecas").doc(productId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Peca nao encontrada.");
      const existing = Array.isArray(snapshot.data()?.historicoEstoque) ? snapshot.data().historicoEstoque.slice(-79) : [];
      existing.push({
        descricao: description,
        createdAt: new Date().toISOString(),
        userId: user.uid,
        userName: user.name || user.email || "Equipe de producao"
      });
      transaction.update(ref, { ...payload, historicoEstoque: existing, updatedAt: FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    if (isSessionRequestError(error)) {
      return res.status(Number(error.status) || 401).json({ ok: false, error: error.message });
    }
    const message = ["Quantidade invalida.", "Lista de cores invalida.", "Ficha tecnica invalida.", "Alteracao invalida.", "Nenhuma alteracao de producao foi informada.", "Peca nao encontrada."].includes(error?.message)
      ? error.message
      : "Nao foi possivel salvar esta movimentacao agora.";
    console.error("[vercel.production.stock.update]", error);
    return res.status(message === error?.message ? 400 : 500).json({ ok: false, error: message });
  }
}
