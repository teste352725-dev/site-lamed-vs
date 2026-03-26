import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

const CATALOG_SETTINGS_DOC_ID = "__catalog_settings";
const STOREFRONT_COPY_DOC_ID = "homepage";

const PRODUCT_STATUS = new Set(["active", "inactive"]);
const PRODUCT_TYPE = new Set(["standard", "combo"]);

class StorefrontAdminError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "StorefrontAdminError";
    this.status = status;
  }
}

function sanitizePlainText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeSlug(value, maxLength = 80) {
  return sanitizePlainText(value, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeInteger(value, { min = 0, max = 999999, fallback = 0 } = {}) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeMoney(value, { min = 0, max = 100000, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100;
  return Math.min(max, Math.max(min, rounded));
}

function sanitizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function normalizeStorefrontCopy(payload) {
  const source = payload && typeof payload === "object" ? payload : {};

  return {
    heroTitle: sanitizePlainText(source.heroTitle, 120),
    heroSubtitle: sanitizePlainText(source.heroSubtitle, 220),
    heroCta: sanitizePlainText(source.heroCta, 60),
    shopTitle: sanitizePlainText(source.shopTitle, 120),
    shopSubtitle: sanitizePlainText(source.shopSubtitle, 260),
    philosophyTitle: sanitizePlainText(source.philosophyTitle, 120),
    philosophyBody: sanitizePlainText(source.philosophyBody, 1400),
    messageTitle: sanitizePlainText(source.messageTitle, 120),
    messageBody1: sanitizePlainText(source.messageBody1, 1400),
    messageBody2: sanitizePlainText(source.messageBody2, 1400)
  };
}

function normalizeCollectionEditorEntry(entry, fallbackOrder = 0) {
  if (!entry || typeof entry !== "object") return null;

  const id = sanitizePlainText(entry.id, 120);
  const nome = sanitizePlainText(entry.nome, 120);
  const ordem = sanitizeInteger(entry.ordem, { min: 0, max: 99999, fallback: fallbackOrder });
  const ativa = sanitizeBoolean(entry.ativa, true);

  if (!id || !nome) return null;

  return { id, nome, ordem, ativa };
}

function normalizeCategoryEditorEntries(entries) {
  const normalized = [];
  const seen = new Set();

  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;

    const slug = sanitizeSlug(entry.slug || entry.nome, 80);
    const nome = sanitizePlainText(entry.nome || entry.slug, 120);
    if (!slug || !nome || seen.has(slug)) return;

    seen.add(slug);
    normalized.push({
      slug,
      nome,
      ordem: sanitizeInteger(entry.ordem, { min: 0, max: 99999, fallback: (index + 1) * 10 }),
      ativa: sanitizeBoolean(entry.ativa, true)
    });
  });

  return normalized.sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome, "pt-BR"));
}

async function updateProductStatus(db, payload, adminUid) {
  const productId = sanitizePlainText(payload?.productId, 120);
  const nextStatus = sanitizePlainText(payload?.status, 20).toLowerCase();

  if (!productId || !PRODUCT_STATUS.has(nextStatus)) {
    throw new StorefrontAdminError(400, "Produto ou status invalido.");
  }

  await db.collection("pecas").doc(productId).update({
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  });

  return {
    kind: "product_status",
    productId,
    status: nextStatus
  };
}

async function updateProductQuickEdit(db, payload, adminUid) {
  const productId = sanitizePlainText(payload?.productId, 120);
  if (!productId) {
    throw new StorefrontAdminError(400, "Produto invalido.");
  }

  const productRef = db.collection("pecas").doc(productId);
  const snapshot = await productRef.get();
  if (!snapshot.exists) {
    throw new StorefrontAdminError(404, "Produto nao encontrado.");
  }

  const current = snapshot.data() || {};
  const nome = sanitizePlainText(payload?.nome, 120);
  const descricao = sanitizePlainText(payload?.descricao, 2000);
  const categoria = sanitizeSlug(payload?.categoria, 80);
  const status = sanitizePlainText(payload?.status, 20).toLowerCase();
  const tipo = sanitizePlainText(current?.tipo || payload?.tipo || "standard", 20).toLowerCase();
  const colecaoIdRaw = sanitizePlainText(payload?.colecaoId, 120);
  const colecaoId = colecaoIdRaw || null;
  const desconto = sanitizeInteger(payload?.desconto, { min: 0, max: 95, fallback: 0 });
  const ordem = sanitizeInteger(payload?.ordem, { min: 0, max: 99999, fallback: 0 });
  const preco = sanitizeMoney(payload?.preco, { min: 0, max: 100000, fallback: NaN });
  const personalizavel = sanitizeBoolean(payload?.personalizavel, false);

  if (!nome) {
    throw new StorefrontAdminError(400, "Nome invalido.");
  }

  if (!categoria) {
    throw new StorefrontAdminError(400, "Categoria invalida.");
  }

  if (!PRODUCT_STATUS.has(status)) {
    throw new StorefrontAdminError(400, "Status invalido.");
  }

  if (!PRODUCT_TYPE.has(tipo)) {
    throw new StorefrontAdminError(400, "Tipo de produto invalido.");
  }

  if (!Number.isFinite(preco) || preco < 0) {
    throw new StorefrontAdminError(400, "Preco invalido.");
  }

  if (colecaoId && colecaoId !== CATALOG_SETTINGS_DOC_ID) {
    const collectionSnap = await db.collection("colecoes").doc(colecaoId).get();
    if (!collectionSnap.exists) {
      throw new StorefrontAdminError(404, "Colecao nao encontrada.");
    }
  }

  const nextProduct = {
    ...current,
    nome,
    descricao,
    categoria,
    preco,
    desconto,
    ordem,
    status,
    colecaoId,
    personalizavel: tipo === "combo" ? false : personalizavel,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  };

  await productRef.set(nextProduct, { merge: true });

  return {
    kind: "product_quick_edit",
    product: {
      id: productId,
      ...nextProduct,
      updatedAt: new Date().toISOString()
    }
  };
}

async function updateCollectionStatus(db, payload, adminUid) {
  const collectionId = sanitizePlainText(payload?.collectionId, 120);
  if (!collectionId) {
    throw new StorefrontAdminError(400, "Colecao invalida.");
  }

  const ativa = sanitizeBoolean(payload?.ativa, false);
  await db.collection("colecoes").doc(collectionId).set({
    ativa,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  }, { merge: true });

  return {
    kind: "collection_status",
    collectionId,
    ativa
  };
}

async function saveCollectionsBulk(db, payload, adminUid) {
  const entries = Array.isArray(payload?.collections) ? payload.collections : [];
  const normalizedEntries = entries
    .map((entry, index) => normalizeCollectionEditorEntry(entry, (index + 1) * 10))
    .filter(Boolean);

  if (normalizedEntries.length === 0) {
    throw new StorefrontAdminError(400, "Nenhuma colecao valida foi enviada.");
  }

  const batch = db.batch();
  normalizedEntries.forEach((entry) => {
    const ref = db.collection("colecoes").doc(entry.id);
    batch.set(ref, {
      nome: entry.nome,
      ordem: entry.ordem,
      ativa: entry.ativa,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByAdmin: sanitizePlainText(adminUid, 128)
    }, { merge: true });
  });

  await batch.commit();

  const collectionsSnap = await db.collection("colecoes").get();
  const collections = collectionsSnap.docs
    .filter((doc) => doc.id !== CATALOG_SETTINGS_DOC_ID)
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (Number(a?.ordem) || 0) - (Number(b?.ordem) || 0) || sanitizePlainText(a?.nome, 120).localeCompare(sanitizePlainText(b?.nome, 120), "pt-BR"));

  return {
    kind: "collections_bulk_save",
    collections
  };
}

async function updateCategoryVisibility(db, payload, adminUid) {
  const slug = sanitizePlainText(payload?.slug, 80);
  if (!slug) {
    throw new StorefrontAdminError(400, "Categoria invalida.");
  }

  const snapshot = await db.collection("colecoes").doc(CATALOG_SETTINGS_DOC_ID).get();
  const currentCategories = snapshot.exists && Array.isArray(snapshot.data()?.categorias)
    ? snapshot.data().categorias
    : [];

  const found = currentCategories.some((category) => sanitizePlainText(category?.slug, 80) === slug);
  if (!found) {
    throw new StorefrontAdminError(404, "Categoria nao encontrada na configuracao da loja.");
  }

  const ativa = sanitizeBoolean(payload?.ativa, true);
  const categorias = currentCategories.map((category, index) => {
    const currentSlug = sanitizePlainText(category?.slug, 80);
    return {
      slug: currentSlug,
      nome: sanitizePlainText(category?.nome || currentSlug, 120),
      ordem: Number.isFinite(Number(category?.ordem)) ? Number(category.ordem) : index * 10 + 10,
      ativa: currentSlug === slug ? ativa : category?.ativa !== false
    };
  });

  await db.collection("colecoes").doc(CATALOG_SETTINGS_DOC_ID).set({
    kind: "catalog_settings",
    categorias,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  }, { merge: true });

  return {
    kind: "category_visibility",
    slug,
    ativa
  };
}

async function saveCategoriesBulk(db, payload, adminUid) {
  const categorias = normalizeCategoryEditorEntries(payload?.categories);
  if (categorias.length === 0) {
    throw new StorefrontAdminError(400, "Nenhuma categoria valida foi enviada.");
  }

  await db.collection("colecoes").doc(CATALOG_SETTINGS_DOC_ID).set({
    kind: "catalog_settings",
    categorias,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  }, { merge: true });

  return {
    kind: "categories_bulk_save",
    categories: categorias
  };
}

async function updateStorefrontCopy(db, payload, adminUid) {
  const copy = normalizeStorefrontCopy(payload);

  await db.collection("site_config").doc(STOREFRONT_COPY_DOC_ID).set({
    kind: "home_copy",
    ...copy,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  }, { merge: true });

  return {
    kind: "site_copy",
    copy
  };
}

export function isStorefrontAdminError(error) {
  return error instanceof StorefrontAdminError;
}

export async function applyStorefrontAdminAction({ action, payload, adminUid }) {
  const safeAction = sanitizePlainText(action, 40).toLowerCase();
  const db = getAdminDb();

  if (safeAction === "site_copy") {
    return updateStorefrontCopy(db, payload, adminUid);
  }

  if (safeAction === "product_status") {
    return updateProductStatus(db, payload, adminUid);
  }

  if (safeAction === "product_quick_edit") {
    return updateProductQuickEdit(db, payload, adminUid);
  }

  if (safeAction === "collection_status") {
    return updateCollectionStatus(db, payload, adminUid);
  }

  if (safeAction === "collections_bulk_save") {
    return saveCollectionsBulk(db, payload, adminUid);
  }

  if (safeAction === "category_visibility") {
    return updateCategoryVisibility(db, payload, adminUid);
  }

  if (safeAction === "categories_bulk_save") {
    return saveCategoriesBulk(db, payload, adminUid);
  }

  throw new StorefrontAdminError(400, "Acao administrativa invalida.");
}
