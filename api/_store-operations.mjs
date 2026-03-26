import { randomUUID } from "node:crypto";
import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

export const STOREFRONT_COPY_DOC_ID = "homepage";
export const STORE_OPERATIONS_DOC_ID = "store_operations";

function sanitizePlainText(value, maxLength = 220) {
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

function sanitizeInteger(value, { min = 0, max = 9999, fallback = 0 } = {}) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeIsoDateTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function sanitizeScheduleId(value, fallbackPrefix) {
  const safe = sanitizePlainText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (safe) return safe;
  return `${fallbackPrefix}-${randomUUID()}`;
}

export function getDefaultNotificationRules() {
  return {
    orderStatus: true,
    chatReply: true,
    favoritePromotion: true,
    purchasePromotion: true,
    favoriteLowStock: false,
    collectionLaunch: true,
    lowStockThreshold: 3
  };
}

export function getDefaultStoreOperations() {
  return {
    kind: "store_operations",
    publicStoreEnabled: true,
    maintenanceMode: false,
    maintenanceTitle: "Estamos ajustando a loja",
    maintenanceBody: "Voltamos em instantes com a loja pronta para receber seu pedido.",
    closedTitle: "Loja temporariamente fechada",
    closedBody: "Estamos preparando uma nova fase da loja. Em breve tudo volta ao ar.",
    notificationRules: getDefaultNotificationRules(),
    discountSchedules: [],
    collectionSchedules: []
  };
}

function normalizeNotificationRules(value) {
  const defaults = getDefaultNotificationRules();
  const raw = value && typeof value === "object" ? value : {};

  return {
    orderStatus: sanitizeBoolean(raw.orderStatus, defaults.orderStatus),
    chatReply: sanitizeBoolean(raw.chatReply, defaults.chatReply),
    favoritePromotion: sanitizeBoolean(raw.favoritePromotion, defaults.favoritePromotion),
    purchasePromotion: sanitizeBoolean(raw.purchasePromotion, defaults.purchasePromotion),
    favoriteLowStock: sanitizeBoolean(raw.favoriteLowStock, defaults.favoriteLowStock),
    collectionLaunch: sanitizeBoolean(raw.collectionLaunch, defaults.collectionLaunch),
    lowStockThreshold: sanitizeInteger(raw.lowStockThreshold, {
      min: 1,
      max: 50,
      fallback: defaults.lowStockThreshold
    })
  };
}

function normalizeDiscountSchedules(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;

      const id = sanitizeScheduleId(entry.id, "discount");
      const label = sanitizePlainText(entry.label, 120) || `Remover descontos ${index + 1}`;
      const runAt = sanitizeIsoDateTime(entry.runAt || entry.at);
      if (!runAt) return null;

      return {
        id,
        label,
        runAt,
        enabled: sanitizeBoolean(entry.enabled, true),
        lastRunAt: sanitizeIsoDateTime(entry.lastRunAt)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.runAt.localeCompare(right.runAt));
}

function normalizeCollectionSchedules(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;

      const id = sanitizeScheduleId(entry.id, "collection");
      const collectionId = sanitizePlainText(entry.collectionId, 120);
      const startAt = sanitizeIsoDateTime(entry.startAt);
      const endAt = sanitizeIsoDateTime(entry.endAt);
      if (!collectionId || (!startAt && !endAt)) return null;

      return {
        id,
        label: sanitizePlainText(entry.label, 120) || `Colecao ${index + 1}`,
        collectionId,
        startAt,
        endAt,
        enabled: sanitizeBoolean(entry.enabled, true),
        lastStartRunAt: sanitizeIsoDateTime(entry.lastStartRunAt),
        lastEndRunAt: sanitizeIsoDateTime(entry.lastEndRunAt)
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftKey = left.startAt || left.endAt || "";
      const rightKey = right.startAt || right.endAt || "";
      return leftKey.localeCompare(rightKey);
    });
}

export function mergeStoreOperationsWithDefaults(rawValue) {
  const defaults = getDefaultStoreOperations();
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};

  return {
    ...defaults,
    publicStoreEnabled: sanitizeBoolean(raw.publicStoreEnabled, defaults.publicStoreEnabled),
    maintenanceMode: sanitizeBoolean(raw.maintenanceMode, defaults.maintenanceMode),
    maintenanceTitle: sanitizePlainText(raw.maintenanceTitle, 120) || defaults.maintenanceTitle,
    maintenanceBody: sanitizePlainText(raw.maintenanceBody, 400) || defaults.maintenanceBody,
    closedTitle: sanitizePlainText(raw.closedTitle, 120) || defaults.closedTitle,
    closedBody: sanitizePlainText(raw.closedBody, 400) || defaults.closedBody,
    notificationRules: normalizeNotificationRules(raw.notificationRules),
    discountSchedules: normalizeDiscountSchedules(raw.discountSchedules),
    collectionSchedules: normalizeCollectionSchedules(raw.collectionSchedules)
  };
}

export async function getStoreOperations(db = getAdminDb()) {
  const snapshot = await db.collection("site_config").doc(STORE_OPERATIONS_DOC_ID).get();
  const current = snapshot.exists ? snapshot.data() : null;
  return mergeStoreOperationsWithDefaults(current);
}

export function isPublicStorefrontBlocked(operations, isAdmin = false) {
  if (isAdmin) return false;
  const normalized = mergeStoreOperationsWithDefaults(operations);
  return normalized.maintenanceMode || normalized.publicStoreEnabled === false;
}

export async function saveStoreOperationsConfig(db, payload, adminUid) {
  const normalized = mergeStoreOperationsWithDefaults(payload);

  await db.collection("site_config").doc(STORE_OPERATIONS_DOC_ID).set({
    kind: "store_operations",
    publicStoreEnabled: normalized.publicStoreEnabled,
    maintenanceMode: normalized.maintenanceMode,
    maintenanceTitle: normalized.maintenanceTitle,
    maintenanceBody: normalized.maintenanceBody,
    closedTitle: normalized.closedTitle,
    closedBody: normalized.closedBody,
    notificationRules: normalized.notificationRules,
    discountSchedules: normalized.discountSchedules,
    collectionSchedules: normalized.collectionSchedules,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByAdmin: sanitizePlainText(adminUid, 128)
  }, { merge: true });

  return normalized;
}
