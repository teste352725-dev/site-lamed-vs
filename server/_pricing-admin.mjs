import { FieldValue, getAdminAuth, getAdminDb } from "./_firebase-admin.mjs";
import { isAdminDecodedToken } from "./_session.mjs";
import { enforceInMemoryRateLimit } from "./_security.mjs";
import { CHECKOUT_CARD_SURCHARGE_PERCENT, CHECKOUT_PIX_DISCOUNT_PERCENT } from "./_commerce-config.mjs";

const AREAS = new Set(["roupa", "mesa_posta", "sob_medida"]);
const SOURCE_MODES = new Set(["novo", "produto"]);
const MATERIAL_UNITS = new Set(["m", "cm", "un", "kg", "g", "rolo", "pacote", "servico"]);
const MATERIAL_SCOPES = new Set(["peca", "lote"]);
const PRICING_METHODS = new Set(["acrescimo", "margem"]);
const MEASURE_UNITS = new Set(["cm", "m", "mm", "un"]);
const MAX_MONEY_CENTS = 100_000_000_00;
const MAX_ACTIVE_RECORDS_PER_USER = 250;
const MAX_PAYLOAD_BYTES = 32_000;

const PRICING_TEMPLATES = {
  roupa: [
    {
      id: "camisa", label: "Camisa", minutes: 120,
      materials: [
        { name: "Tecido principal", quantity: 1.5, unit: "m", scope: "peca" },
        { name: "Entretela", quantity: 0.3, unit: "m", scope: "peca" },
        { name: "Botões", quantity: 10, unit: "un", scope: "peca" },
        { name: "Linha e acabamento", quantity: 1, unit: "un", scope: "peca" }
      ]
    },
    {
      id: "vestido", label: "Vestido", minutes: 210,
      materials: [
        { name: "Tecido principal", quantity: 3, unit: "m", scope: "peca" },
        { name: "Zíper", quantity: 1, unit: "un", scope: "peca" },
        { name: "Linha e acabamento", quantity: 1, unit: "un", scope: "peca" }
      ]
    },
    {
      id: "saia_calca", label: "Saia ou calça", minutes: 100,
      materials: [
        { name: "Tecido principal", quantity: 2, unit: "m", scope: "peca" },
        { name: "Zíper ou botões", quantity: 1, unit: "un", scope: "peca" },
        { name: "Linha e acabamento", quantity: 1, unit: "un", scope: "peca" }
      ]
    },
    { id: "roupa_livre", label: "Modelo livre", minutes: 0, materials: [{ name: "Material principal", quantity: 0, unit: "m", scope: "peca" }] }
  ],
  mesa_posta: [
    {
      id: "guardanapo", label: "Guardanapo", minutes: 20,
      materials: [
        { name: "Tecido principal", quantity: 0.18, unit: "m", scope: "peca" },
        { name: "Linha e acabamento", quantity: 1, unit: "un", scope: "peca" }
      ]
    },
    {
      id: "lugar_americano", label: "Lugar americano", minutes: 30,
      materials: [
        { name: "Tecido principal", quantity: 0.45, unit: "m", scope: "peca" },
        { name: "Forro ou estrutura", quantity: 0.45, unit: "m", scope: "peca" },
        { name: "Linha e acabamento", quantity: 1, unit: "un", scope: "peca" }
      ]
    },
    {
      id: "caminho_mesa", label: "Caminho de mesa", minutes: 70,
      materials: [
        { name: "Tecido principal", quantity: 1.4, unit: "m", scope: "peca" },
        { name: "Linha e acabamento", quantity: 1, unit: "un", scope: "peca" }
      ]
    },
    { id: "mesa_livre", label: "Modelo livre", minutes: 0, materials: [{ name: "Material principal", quantity: 0, unit: "m", scope: "peca" }] }
  ],
  sob_medida: [
    { id: "roupa_sob_medida", label: "Roupa sob medida", minutes: 0, materials: [{ name: "Tecido principal", quantity: 0, unit: "m", scope: "peca" }], measurements: ["Busto", "Cintura", "Quadril", "Comprimento"] },
    { id: "mesa_sob_medida", label: "Mesa sob medida", minutes: 0, materials: [{ name: "Material principal", quantity: 0, unit: "m", scope: "peca" }], measurements: ["Largura", "Comprimento", "Altura"] },
    { id: "projeto_especial", label: "Projeto especial", minutes: 0, materials: [{ name: "Material ou serviço principal", quantity: 0, unit: "un", scope: "peca" }], measurements: ["Largura", "Altura", "Profundidade"] }
  ]
};

function pricingError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, max = 160) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function cleanMultilineText(value, max = 2_000) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function cleanId(value, fieldName = "registro") {
  const id = cleanText(value, 160);
  if (!id || id.includes("/") || !/^[\w.-]+$/u.test(id)) {
    throw pricingError(400, `${fieldName} invalido.`);
  }
  return id;
}

function safeNumber(value, { min = 0, max = 1_000_000, integer = false, label = "Valor" } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw pricingError(400, `${label} invalido.`);
  }
  return number;
}

function safeCents(value, label = "Valor") {
  return safeNumber(value, { min: 0, max: MAX_MONEY_CENTS, integer: true, label });
}

function safePercent(value, { max = 100, label = "Percentual" } = {}) {
  return safeNumber(value, { min: 0, max, label });
}

function sanitizeMaterials(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw pricingError(400, "Adicione entre 1 e 50 materiais.");
  }

  return value.map((candidate, index) => {
    const name = cleanText(candidate?.name, 100);
    const unit = MATERIAL_UNITS.has(candidate?.unit) ? candidate.unit : "un";
    const scope = MATERIAL_SCOPES.has(candidate?.scope) ? candidate.scope : "peca";
    if (!name) throw pricingError(400, `Informe o nome do material ${index + 1}.`);
    return {
      name,
      quantity: safeNumber(candidate?.quantity, { min: 0, max: 1_000_000, label: `Quantidade do material ${index + 1}` }),
      unit,
      scope,
      unitCostCents: safeCents(candidate?.unitCostCents, `Custo do material ${index + 1}`)
    };
  });
}

function sanitizeMeasurements(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 40) throw pricingError(400, "Lista de medidas invalida.");
  return value.map((candidate) => ({
    name: cleanText(candidate?.name, 80),
    value: cleanText(candidate?.value, 40),
    unit: MEASURE_UNITS.has(candidate?.unit) ? candidate.unit : "cm"
  })).filter((measure) => measure.name && measure.value);
}

function sanitizePayload(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw pricingError(400, "Ficha de precificacao invalida.");
  }

  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
  } catch (error) {
    throw pricingError(400, "Ficha de precificacao invalida.");
  }
  if (payloadBytes > MAX_PAYLOAD_BYTES) throw pricingError(413, "A ficha ficou grande demais.");

  const name = cleanText(candidate.name, 160);
  const area = AREAS.has(candidate.area) ? candidate.area : null;
  if (!name) throw pricingError(400, "Informe o nome da peca.");
  if (!area) throw pricingError(400, "Escolha uma area valida.");

  const sourceMode = SOURCE_MODES.has(candidate?.source?.mode) ? candidate.source.mode : "novo";
  const sourceProductId = candidate?.source?.productId ? cleanId(candidate.source.productId, "Produto") : null;
  const quantity = safeNumber(candidate.quantity, { min: 1, max: 10_000, integer: true, label: "Quantidade" });
  const materials = sanitizeMaterials(candidate.materials);
  const labor = {
    minutesPerPiece: safeNumber(candidate?.labor?.minutesPerPiece, { min: 0, max: 100_000, label: "Tempo de producao" }),
    hourlyRateCents: safeCents(candidate?.labor?.hourlyRateCents, "Valor da hora")
  };
  const extras = {
    perPieceCents: safeCents(candidate?.extras?.perPieceCents, "Custo extra por peca"),
    batchCents: safeCents(candidate?.extras?.batchCents, "Custo fixo do lote"),
    wastePercent: safePercent(candidate?.extras?.wastePercent, { max: 100, label: "Percentual de perda" }),
    overheadPercent: safePercent(candidate?.extras?.overheadPercent, { max: 500, label: "Percentual de despesas" })
  };
  const method = PRICING_METHODS.has(candidate?.pricing?.method) ? candidate.pricing.method : "acrescimo";
  const percentage = safePercent(candidate?.pricing?.percentage, {
    max: method === "margem" ? 95 : 1_000,
    label: method === "margem" ? "Margem desejada" : "Acrescimo"
  });
  const pricing = {
    method,
    percentage,
    cardFeePercent: CHECKOUT_CARD_SURCHARGE_PERCENT,
    pixDiscountPercent: CHECKOUT_PIX_DISCOUNT_PERCENT
  };

  return {
    name,
    reference: cleanText(candidate.reference, 100),
    area,
    template: cleanText(candidate.template, 80),
    source: {
      mode: sourceMode,
      productId: sourceMode === "produto" ? sourceProductId : null,
      productName: sourceMode === "produto" ? cleanText(candidate?.source?.productName, 160) : "",
      currentPriceCents: sourceMode === "produto"
        ? safeCents(candidate?.source?.currentPriceCents || 0, "Preco atual")
        : 0
    },
    quantity,
    materials,
    labor,
    extras,
    pricing,
    measurements: sanitizeMeasurements(candidate.measurements),
    notes: cleanMultilineText(candidate.notes, 2_000)
  };
}

function calculateTotals(data) {
  const materialBatchCents = Math.round(data.materials.reduce((sum, material) => {
    const multiplier = material.scope === "lote" ? 1 : data.quantity;
    return sum + (material.quantity * material.unitCostCents * multiplier);
  }, 0));
  const wasteCents = Math.round(materialBatchCents * (data.extras.wastePercent / 100));
  const laborBatchCents = Math.round((data.labor.minutesPerPiece / 60) * data.labor.hourlyRateCents * data.quantity);
  const extrasBatchCents = (data.extras.perPieceCents * data.quantity) + data.extras.batchCents;
  const directBatchCents = materialBatchCents + wasteCents + laborBatchCents + extrasBatchCents;
  const overheadCents = Math.round(directBatchCents * (data.extras.overheadPercent / 100));
  const batchCostCents = directBatchCents + overheadCents;
  const unitCostCents = Math.ceil(batchCostCents / data.quantity);
  const baseBatchPriceCents = data.pricing.method === "margem"
    ? Math.ceil(batchCostCents / (1 - (data.pricing.percentage / 100)))
    : Math.ceil(batchCostCents * (1 + (data.pricing.percentage / 100)));
  const baseUnitPriceCents = Math.ceil(baseBatchPriceCents / data.quantity);
  const registeredBatchPriceCents = baseUnitPriceCents * data.quantity;
  const cardUnitPriceCents = Math.round(baseUnitPriceCents * (1 + (data.pricing.cardFeePercent / 100)));
  const pixUnitPriceCents = Math.round(baseUnitPriceCents * (1 - (data.pricing.pixDiscountPercent / 100)));
  const cardBatchPriceCents = Math.round(registeredBatchPriceCents * (1 + (data.pricing.cardFeePercent / 100)));
  const pixBatchPriceCents = Math.round(registeredBatchPriceCents * (1 - (data.pricing.pixDiscountPercent / 100)));

  const totals = {
    materialBatchCents,
    wasteCents,
    laborBatchCents,
    extrasBatchCents,
    overheadCents,
    batchCostCents,
    unitCostCents,
    baseUnitPriceCents,
    baseBatchPriceCents: registeredBatchPriceCents,
    cardUnitPriceCents,
    pixUnitPriceCents,
    cardBatchPriceCents,
    pixBatchPriceCents,
    baseProfitBatchCents: registeredBatchPriceCents - batchCostCents,
    cardProfitBatchCents: cardBatchPriceCents - batchCostCents,
    pixProfitBatchCents: pixBatchPriceCents - batchCostCents
  };

  if (Object.values(totals).some((value) => !Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_CENTS)) {
    throw pricingError(400, "O resultado ultrapassou o limite aceito. Revise quantidades e custos.");
  }
  return totals;
}

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function outputNumber(value, { min = 0, max = 1_000_000, integer = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  const bounded = Math.min(max, Math.max(min, numeric));
  return integer ? Math.round(bounded) : bounded;
}

function outputTotals(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const positiveFields = [
    "materialBatchCents", "wasteCents", "laborBatchCents", "extrasBatchCents", "overheadCents",
    "batchCostCents", "unitCostCents", "baseUnitPriceCents", "cardUnitPriceCents", "pixUnitPriceCents",
    "baseBatchPriceCents", "cardBatchPriceCents", "pixBatchPriceCents"
  ];
  const output = Object.fromEntries(positiveFields.map((field) => [field, outputNumber(candidate[field], { max: MAX_MONEY_CENTS, integer: true })]));
  const signedMoney = (input) => {
    const numeric = Number(input);
    return Number.isFinite(numeric) ? Math.round(Math.min(MAX_MONEY_CENTS, Math.max(-MAX_MONEY_CENTS, numeric))) : 0;
  };
  output.baseProfitBatchCents = signedMoney(candidate.baseProfitBatchCents);
  output.cardProfitBatchCents = signedMoney(candidate.cardProfitBatchCents);
  output.pixProfitBatchCents = signedMoney(candidate.pixProfitBatchCents);
  return output;
}

function publicV2Record(id, data, canManage = false, { templateOnly = false } = {}) {
  const sourceCandidate = data.source && typeof data.source === "object" && !Array.isArray(data.source) ? data.source : {};
  const sourceMode = SOURCE_MODES.has(sourceCandidate.mode) ? sourceCandidate.mode : "novo";
  const materials = (Array.isArray(data.materials) ? data.materials : []).slice(0, 50).map((material) => ({
    name: cleanText(material?.name, 100),
    quantity: outputNumber(material?.quantity),
    unit: MATERIAL_UNITS.has(material?.unit) ? material.unit : "un",
    scope: MATERIAL_SCOPES.has(material?.scope) ? material.scope : "peca",
    unitCostCents: outputNumber(material?.unitCostCents, { max: MAX_MONEY_CENTS, integer: true })
  })).filter((material) => material.name);
  const measurements = (Array.isArray(data.measurements) ? data.measurements : []).slice(0, 40).map((measurement) => ({
    name: cleanText(measurement?.name, 80),
    value: cleanText(measurement?.value, 40),
    unit: MEASURE_UNITS.has(measurement?.unit) ? measurement.unit : "cm"
  })).filter((measurement) => measurement.name && measurement.value);
  return {
    id,
    schemaVersion: 2,
    name: cleanText(data.name, 160) || "Ficha sem nome",
    reference: templateOnly ? "" : cleanText(data.reference, 100),
    area: AREAS.has(data.area) ? data.area : "sob_medida",
    template: cleanText(data.template, 80),
    source: {
      mode: sourceMode,
      productId: sourceMode === "produto" ? cleanText(sourceCandidate.productId, 160) : null,
      productName: sourceMode === "produto" ? cleanText(sourceCandidate.productName, 160) : "",
      currentPriceCents: sourceMode === "produto" ? outputNumber(sourceCandidate.currentPriceCents, { max: MAX_MONEY_CENTS, integer: true }) : 0
    },
    quantity: outputNumber(data.quantity, { min: 1, max: 10_000, integer: true }),
    materials,
    labor: {
      minutesPerPiece: outputNumber(data.labor?.minutesPerPiece, { max: 100_000 }),
      hourlyRateCents: outputNumber(data.labor?.hourlyRateCents, { max: MAX_MONEY_CENTS, integer: true })
    },
    extras: {
      perPieceCents: outputNumber(data.extras?.perPieceCents, { max: MAX_MONEY_CENTS, integer: true }),
      batchCents: outputNumber(data.extras?.batchCents, { max: MAX_MONEY_CENTS, integer: true }),
      wastePercent: outputNumber(data.extras?.wastePercent, { max: 100 }),
      overheadPercent: outputNumber(data.extras?.overheadPercent, { max: 500 })
    },
    pricing: {
      method: PRICING_METHODS.has(data.pricing?.method) ? data.pricing.method : "acrescimo",
      percentage: outputNumber(data.pricing?.percentage, { max: data.pricing?.method === "margem" ? 95 : 1_000 }),
      cardFeePercent: outputNumber(data.pricing?.cardFeePercent, { max: 50 }),
      pixDiscountPercent: outputNumber(data.pricing?.pixDiscountPercent, { max: 50 })
    },
    measurements: templateOnly ? [] : measurements,
    notes: templateOnly ? "" : cleanMultilineText(data.notes, 2_000),
    totals: outputTotals(data.totals),
    sharedWithProduction: data.sharedWithProduction === true,
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    canManage
  };
}

function publicLegacyRecord(id, data) {
  const legacyItems = Array.isArray(data.itens) ? data.itens : [];
  return {
    id,
    schemaVersion: 1,
    legacy: true,
    name: cleanText(data.nome, 160) || "Calculo antigo",
    area: "sob_medida",
    quantity: legacyItems.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0) || 1,
    resultLabel: cleanText(data.resultadoFinal, 80),
    pixLabel: cleanText(data.resultadoPix, 80),
    createdAt: timestampIso(data.data || data.createdAt),
    updatedAt: timestampIso(data.updatedAt || data.data),
    canManage: true
  };
}

async function requirePricingAccount(user) {
  const account = await getAdminAuth().getUser(user.uid);
  if (account.disabled) throw pricingError(403, "Este acesso foi bloqueado pela administracao.");
  const primaryAdmin = isAdminDecodedToken({ uid: user.uid });
  const currentClaims = account.customClaims || {};
  const isAdmin = primaryAdmin || currentClaims.admin === true;
  const isProduction = isAdmin || currentClaims.production === true;
  const tokensValidAfter = account.tokensValidAfterTime ? new Date(account.tokensValidAfterTime).getTime() : 0;
  const authenticatedAt = Number(user.auth_time || 0) * 1000;
  if (tokensValidAfter && authenticatedAt && authenticatedAt < tokensValidAfter) {
    throw pricingError(401, "Sua sessao foi atualizada. Entre novamente para continuar.");
  }
  if (!isProduction) {
    throw pricingError(403, "Esta conta nao possui acesso a precificacao.");
  }
  return { isAdmin, account };
}

async function listPricing({ user, isAdmin }) {
  const db = getAdminDb();
  let snapshots;
  if (isAdmin) {
    snapshots = await Promise.all([
      db.collection("precificacoes").orderBy("updatedAt", "desc").limit(80).get(),
      db.collection("precificacoes").orderBy("data", "desc").limit(40).get()
    ]);
  } else {
    snapshots = await Promise.all([
      db.collection("precificacoes").where("createdBy", "==", user.uid).where("status", "==", "active").limit(MAX_ACTIVE_RECORDS_PER_USER).get(),
      db.collection("precificacoes").where("sharedWithProduction", "==", true).where("status", "==", "active").limit(MAX_ACTIVE_RECORDS_PER_USER).get()
    ]);
  }

  const unique = new Map();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => unique.set(document.id, document)));
  const records = Array.from(unique.values())
    .filter((document) => !document.data()?.archivedAt && document.data()?.status !== "archived")
    .map((document) => {
      const data = document.data() || {};
      if (Number(data.schemaVersion) === 2) {
        const canManage = isAdmin || (data.createdBy === user.uid && data.sharedWithProduction !== true);
        return publicV2Record(document.id, data, canManage, { templateOnly: !canManage });
      }
      return isAdmin ? publicLegacyRecord(document.id, data) : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, 40);
  return { records };
}

async function savePricing({ payload, user, isAdmin }) {
  const data = sanitizePayload(payload);
  const totals = calculateTotals(data);
  if (totals.pixProfitBatchCents < 0) {
    throw pricingError(400, "O preco no Pix ficou abaixo do custo. Reduza o desconto ou aumente o preco.");
  }
  const db = getAdminDb();
  const requestedId = payload?.id ? cleanId(payload.id) : null;
  const ref = requestedId ? db.collection("precificacoes").doc(requestedId) : db.collection("precificacoes").doc();
  const usageRef = db.collection("pricing_usage").doc(cleanId(user.uid, "Usuario"));
  await db.runTransaction(async (transaction) => {
    const existing = requestedId ? await transaction.get(ref) : null;
    const usage = requestedId ? null : await transaction.get(usageRef);
    if (requestedId && !existing.exists) throw pricingError(404, "Ficha nao encontrada.");
    const previous = existing?.data() || {};
    if (previous.archivedAt || previous.status === "archived") throw pricingError(409, "Esta ficha foi arquivada.");
    if (!isAdmin && existing && previous.createdBy !== user.uid) {
      throw pricingError(403, "Voce nao pode alterar esta ficha.");
    }
    if (!isAdmin && previous.sharedWithProduction === true) {
      throw pricingError(403, "Este modelo foi aprovado e compartilhado pela administracao. Abra uma copia para fazer alteracoes.");
    }

    if (!requestedId) {
      const activeCount = outputNumber(usage?.data()?.activeCount, { max: MAX_ACTIVE_RECORDS_PER_USER, integer: true });
      if (activeCount >= MAX_ACTIVE_RECORDS_PER_USER) {
        throw pricingError(429, "Voce atingiu o limite de fichas ativas. Arquive algumas fichas antes de criar outra.");
      }
      transaction.set(usageRef, {
        activeCount: activeCount + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    transaction.set(ref, {
      schemaVersion: 2,
      status: "active",
      ...data,
      totals,
      sharedWithProduction: isAdmin ? payload?.sharedWithProduction === true : previous.sharedWithProduction === true,
      createdAt: previous.createdAt || FieldValue.serverTimestamp(),
      createdBy: previous.createdBy || user.uid,
      createdByName: previous.createdByName || cleanText(user.name || user.email || "Equipe", 120),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      updatedByName: cleanText(user.name || user.email || "Equipe", 120)
    });
  });
  const saved = await ref.get();
  return { record: publicV2Record(saved.id, saved.data(), true) };
}

async function archivePricing({ payload, user, isAdmin }) {
  const id = cleanId(payload?.id);
  const db = getAdminDb();
  const ref = db.collection("precificacoes").doc(id);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    const previous = existing.data() || {};
    if (!existing.exists || previous.archivedAt || previous.status === "archived") {
      throw pricingError(404, "Ficha nao encontrada.");
    }
    if (!isAdmin && previous.createdBy !== user.uid) {
      throw pricingError(403, "Voce nao pode arquivar esta ficha.");
    }
    if (!isAdmin && previous.sharedWithProduction === true) {
      throw pricingError(403, "Este modelo esta compartilhado pela administracao e nao pode ser arquivado pela producao.");
    }
    const ownerId = cleanText(previous.createdBy, 160);
    const usageRef = Number(previous.schemaVersion) === 2 && ownerId
      ? db.collection("pricing_usage").doc(cleanId(ownerId, "Usuario"))
      : null;
    const usage = usageRef ? await transaction.get(usageRef) : null;
    if (usageRef) {
      const activeCount = outputNumber(usage?.data()?.activeCount, { max: MAX_ACTIVE_RECORDS_PER_USER, integer: true });
      transaction.set(usageRef, {
        activeCount: Math.max(0, activeCount - 1),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    transaction.update(ref, { status: "archived", archivedAt: FieldValue.serverTimestamp(), archivedBy: user.uid });
  });
  return { id };
}

export async function applyPricingAction({ action, payload, user }) {
  const access = await requirePricingAccount(user);
  if (!["config", "list", "save", "archive"].includes(action)) {
    throw pricingError(404, "Acao de precificacao nao encontrada.");
  }
  const totalRateLimit = enforceInMemoryRateLimit({
    key: `pricing:${user.uid}:all`,
    maxRequests: 60,
    windowMs: 60_000
  });
  const rateLimit = enforceInMemoryRateLimit({
    key: `pricing:${user.uid}:${action}`,
    maxRequests: action === "list" ? 15 : 20,
    windowMs: 60_000
  });
  if (!totalRateLimit.allowed || !rateLimit.allowed) {
    const retryAfter = Math.max(totalRateLimit.retryAfterSeconds, rateLimit.retryAfterSeconds);
    throw pricingError(429, `Muitas operacoes em seguida. Aguarde ${retryAfter} segundos.`);
  }
  if (action === "config") {
    return {
      templates: PRICING_TEMPLATES,
      checkout: {
        cardFeePercent: CHECKOUT_CARD_SURCHARGE_PERCENT,
        pixDiscountPercent: CHECKOUT_PIX_DISCOUNT_PERCENT
      }
    };
  }
  if (action === "list") return listPricing({ user, isAdmin: access.isAdmin });
  if (action === "save") return savePricing({ payload, user, isAdmin: access.isAdmin });
  if (action === "archive") return archivePricing({ payload, user, isAdmin: access.isAdmin });
}

export { calculateTotals, sanitizePayload };
