import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

const CATALOG_SETTINGS_DOC_ID = "__catalog_settings";
const STOREFRONT_COPY_DOC_ID = "homepage";

const PRODUCT_STATUS = new Set(["active", "inactive"]);

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

  if (safeAction === "collection_status") {
    return updateCollectionStatus(db, payload, adminUid);
  }

  if (safeAction === "category_visibility") {
    return updateCategoryVisibility(db, payload, adminUid);
  }

  throw new StorefrontAdminError(400, "Acao administrativa invalida.");
}
