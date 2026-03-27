import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

const CART_COLLECTION = "shopping_carts";
const MAX_CART_ITEMS = 100;

class CartRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "CartRequestError";
    this.status = status;
  }
}

function sanitizePlainText(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "https://www.lamedvs.com.br/");
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sanitizeHexColor(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "#000000";
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{3,8}$/.test(normalized) ? normalized : "#000000";
}

function toPositiveNumber(value, decimals = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function normalizeShippingProfile(value) {
  if (!value || typeof value !== "object") return null;

  const peso = toPositiveNumber(value.peso, 3);
  const largura = toPositiveNumber(value.largura, 0);
  const altura = toPositiveNumber(value.altura, 0);
  const comprimento = toPositiveNumber(value.comprimento, 0);

  if (!peso || !largura || !altura || !comprimento) return null;
  return { peso, largura, altura, comprimento };
}

function normalizeColor(value) {
  if (!value || typeof value !== "object") return null;
  const nome = sanitizePlainText(value.nome, 40);
  if (!nome) return null;
  return {
    nome,
    hex: sanitizeHexColor(value.hex)
  };
}

function normalizePersonalization(value) {
  if (!value || typeof value !== "object") return null;
  const texto = sanitizePlainText(value.texto, 120);
  const observacoes = sanitizePlainText(value.observacoes, 280);
  if (!texto && !observacoes) return null;
  return { texto, observacoes };
}

function normalizeComboSelections(value) {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce((acc, [key, item]) => {
    const idx = parseInt(key, 10);
    if (!Number.isInteger(idx) || idx < 0 || !item || typeof item !== "object") return acc;

    const nextValue = {};
    const cor = normalizeColor(item.cor);
    const tamanho = sanitizePlainText(item.tamanho, 20);
    if (cor) nextValue.cor = cor;
    if (tamanho) nextValue.tamanho = tamanho;
    if (Object.keys(nextValue).length > 0) {
      acc[idx] = nextValue;
    }
    return acc;
  }, {});
}

function normalizeCartItem(item) {
  if (!item || typeof item !== "object") return null;

  const cartId = sanitizePlainText(item.cartId, 140);
  const id = sanitizePlainText(item.id, 140);
  const nome = sanitizePlainText(item.nome, 160);
  const preco = roundCurrency(Number(item.preco));
  const quantity = Math.max(1, Math.min(99, parseInt(item.quantity, 10) || 0));

  if (!cartId || !id || !nome || !Number.isFinite(preco) || preco < 0 || quantity < 1) {
    return null;
  }

  return {
    cartId,
    id,
    categoria: sanitizePlainText(item.categoria, 80),
    nome,
    preco,
    imagem: normalizeUrl(item.imagem),
    frete: normalizeShippingProfile(item.frete),
    tamanho: sanitizePlainText(item.tamanho, 20),
    cor: normalizeColor(item.cor),
    quantity,
    isCombo: item.isCombo === true,
    componentes: Array.isArray(item.componentes)
      ? item.componentes.map((component) => ({
          id: sanitizePlainText(component?.id, 120),
          nome: sanitizePlainText(component?.nome, 120),
          quantidade: Math.max(1, parseInt(component?.quantidade, 10) || 1),
          categoria: sanitizePlainText(component?.categoria, 80)
        }))
      : null,
    comboSelections: normalizeComboSelections(item.comboSelections),
    personalizacao: normalizePersonalization(item.personalizacao)
  };
}

function normalizeCartItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeCartItem(item))
    .filter(Boolean)
    .slice(0, MAX_CART_ITEMS);
}

function mergeCartItems(primaryItems, secondaryItems) {
  const merged = new Map();

  normalizeCartItems(secondaryItems).forEach((item) => {
    merged.set(item.cartId, item);
  });

  normalizeCartItems(primaryItems).forEach((item) => {
    merged.set(item.cartId, item);
  });

  return [...merged.values()].slice(0, MAX_CART_ITEMS);
}

export function isCartRequestError(error) {
  return error instanceof CartRequestError;
}

export async function getUserCart(userId) {
  const safeUserId = sanitizePlainText(userId, 128);
  if (!safeUserId) {
    throw new CartRequestError(400, "Carrinho invalido.");
  }

  const db = getAdminDb();
  const snapshot = await db.collection(CART_COLLECTION).doc(safeUserId).get();
  if (!snapshot.exists) {
    return {
      ok: true,
      userId: safeUserId,
      items: []
    };
  }

  return {
    ok: true,
    userId: safeUserId,
    items: normalizeCartItems(snapshot.data()?.items)
  };
}

export async function saveUserCart({ userId, items, source = "replace" }) {
  const safeUserId = sanitizePlainText(userId, 128);
  if (!safeUserId) {
    throw new CartRequestError(400, "Carrinho invalido.");
  }

  const db = getAdminDb();
  const ref = db.collection(CART_COLLECTION).doc(safeUserId);
  const normalizedIncoming = normalizeCartItems(items);

  if (source === "merge") {
    const snapshot = await ref.get();
    const currentItems = snapshot.exists ? snapshot.data()?.items : [];
    const mergedItems = mergeCartItems(normalizedIncoming, currentItems);

    await ref.set({
      userId: safeUserId,
      items: mergedItems,
      updatedAt: FieldValue.serverTimestamp(),
      source: "merge"
    }, { merge: true });

    return {
      ok: true,
      userId: safeUserId,
      items: mergedItems
    };
  }

  await ref.set({
    userId: safeUserId,
    items: normalizedIncoming,
    updatedAt: FieldValue.serverTimestamp(),
    source: "replace"
  }, { merge: true });

  return {
    ok: true,
    userId: safeUserId,
    items: normalizedIncoming
  };
}

export async function clearUserCart(userId) {
  const safeUserId = sanitizePlainText(userId, 128);
  if (!safeUserId) return;

  const db = getAdminDb();
  await db.collection(CART_COLLECTION).doc(safeUserId).set({
    userId: safeUserId,
    items: [],
    updatedAt: FieldValue.serverTimestamp(),
    source: "order_clear"
  }, { merge: true });
}
