import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";
import { sendBroadcastNotification, sendCustomNotificationToUsers } from "./_notifications.mjs";
import { STORE_OPERATIONS_DOC_ID, getStoreOperations } from "./_store-operations.mjs";

const AUTOMATION_LOCK_DOC_ID = "__automation_lock";
const AUTOMATION_EVENTS_COLLECTION = "automation_events";
const AUTOMATION_LOCK_MS = 4 * 60 * 1000;

function sanitizePlainText(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeDateValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildStorefrontProductLink(productId) {
  const safeProductId = encodeURIComponent(sanitizePlainText(productId, 120));
  return `https://www.lamedvs.com.br/#/produto/${safeProductId}`;
}

function buildCollectionLink(collectionId) {
  const safeCollectionId = encodeURIComponent(sanitizePlainText(collectionId, 120));
  return `https://www.lamedvs.com.br/#/colecao/${safeCollectionId}`;
}

function getProductPrice(product) {
  const price = Number(product?.preco || 0);
  const discount = Number(product?.desconto || 0);
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round((price * (1 - discount / 100) + Number.EPSILON) * 100) / 100;
}

function getProductInventoryLevel(product) {
  const directStock = parseInt(product?.estoque ?? product?.quantidade ?? product?.stock, 10);
  if (Number.isFinite(directStock) && directStock >= 0) {
    return directStock;
  }

  if (Array.isArray(product?.cores)) {
    const total = product.cores.reduce((acc, color) => {
      const quantity = parseInt(color?.quantidade, 10);
      return acc + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
    }, 0);

    if (total > 0) return total;
  }

  return null;
}

async function acquireAutomationLock(db, trigger) {
  const lockRef = db.collection("site_config").doc(AUTOMATION_LOCK_DOC_ID);
  const now = Date.now();
  const lockedUntil = now + AUTOMATION_LOCK_MS;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const current = snapshot.exists ? (snapshot.data() || {}) : {};
    const currentLockedUntil = Number(current.lockedUntil || 0);

    if (currentLockedUntil && currentLockedUntil > now) {
      throw new Error("automation_locked");
    }

    transaction.set(lockRef, {
      kind: "automation_lock",
      lockedAt: new Date(now).toISOString(),
      lockedUntil,
      trigger: sanitizePlainText(trigger, 120)
    }, { merge: true });
  });

  return async () => {
    await lockRef.set({
      lockedUntil: 0,
      releasedAt: new Date().toISOString()
    }, { merge: true });
  };
}

async function hasAutomationEvent(db, eventId) {
  const snapshot = await db.collection(AUTOMATION_EVENTS_COLLECTION).doc(eventId).get();
  return snapshot.exists;
}

async function recordAutomationEvent(db, eventId, payload) {
  await db.collection(AUTOMATION_EVENTS_COLLECTION).doc(eventId).set({
    kind: "notification_event",
    ...payload,
    createdAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function clearAllActiveDiscounts(db) {
  const snapshot = await db.collection("pecas").where("desconto", ">", 0).get();
  if (snapshot.empty) return { updated: 0 };

  const docs = snapshot.docs;
  for (let index = 0; index < docs.length; index += 400) {
    const batch = db.batch();
    docs.slice(index, index + 400).forEach((doc) => {
      batch.set(doc.ref, {
        desconto: 0,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByAutomation: "discount_schedule"
      }, { merge: true });
    });
    await batch.commit();
  }

  return { updated: docs.length };
}

async function processDiscountSchedules(db, operations, nowIso) {
  const now = normalizeDateValue(nowIso);
  const nextSchedules = [];
  const results = [];

  for (const schedule of operations.discountSchedules) {
    const runAt = normalizeDateValue(schedule.runAt);
    const lastRunAt = normalizeDateValue(schedule.lastRunAt);
    const due = schedule.enabled && runAt && now && runAt <= now && (!lastRunAt || lastRunAt < runAt);

    if (due) {
      const cleared = await clearAllActiveDiscounts(db);
      nextSchedules.push({
        ...schedule,
        lastRunAt: nowIso
      });
      results.push({
        id: schedule.id,
        label: schedule.label,
        updatedProducts: cleared.updated
      });
    } else {
      nextSchedules.push(schedule);
    }
  }

  return { schedules: nextSchedules, results };
}

async function processCollectionSchedules(db, operations, nowIso) {
  const now = normalizeDateValue(nowIso);
  const nextSchedules = [];
  const results = [];

  for (const schedule of operations.collectionSchedules) {
    const nextSchedule = { ...schedule };
    const startAt = normalizeDateValue(schedule.startAt);
    const endAt = normalizeDateValue(schedule.endAt);
    const lastStartRunAt = normalizeDateValue(schedule.lastStartRunAt);
    const lastEndRunAt = normalizeDateValue(schedule.lastEndRunAt);

    if (schedule.enabled && startAt && now && startAt <= now && (!lastStartRunAt || lastStartRunAt < startAt)) {
      const collectionRef = db.collection("colecoes").doc(schedule.collectionId);
      const snapshot = await collectionRef.get();
      const collectionData = snapshot.exists ? (snapshot.data() || {}) : {};

      await collectionRef.set({
        ativa: true,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByAutomation: "collection_start"
      }, { merge: true });

      nextSchedule.lastStartRunAt = nowIso;
      results.push({
        id: schedule.id,
        action: "start",
        collectionId: schedule.collectionId
      });

      if (operations.notificationRules.collectionLaunch) {
        await sendBroadcastNotification({
          title: `Colecao ${sanitizePlainText(collectionData.nome || schedule.label || "especial", 80)} no ar`,
          body: "A vitrine acabou de ganhar uma nova colecao. Toque para ver as pecas.",
          link: buildCollectionLink(schedule.collectionId),
          data: {
            screen: "collection",
            collectionId: sanitizePlainText(schedule.collectionId, 120)
          }
        });
      }
    }

    if (schedule.enabled && endAt && now && endAt <= now && (!lastEndRunAt || lastEndRunAt < endAt)) {
      await db.collection("colecoes").doc(schedule.collectionId).set({
        ativa: false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByAutomation: "collection_end"
      }, { merge: true });

      nextSchedule.lastEndRunAt = nowIso;
      results.push({
        id: schedule.id,
        action: "end",
        collectionId: schedule.collectionId
      });
    }

    nextSchedules.push(nextSchedule);
  }

  return { schedules: nextSchedules, results };
}

async function notifyUsersForPromotion(db, product, operations) {
  const safeProductId = sanitizePlainText(product?.id, 120);
  const safeProductName = sanitizePlainText(product?.nome, 120) || "uma peca";
  const discount = parseInt(product?.desconto, 10) || 0;
  const currentPrice = getProductPrice(product);
  const link = buildStorefrontProductLink(safeProductId);
  const results = [];

  if (discount <= 0 || !safeProductId) {
    return results;
  }

  if (operations.notificationRules.favoritePromotion) {
    const favoritesSnap = await db.collection("usuarios")
      .where("favoritos", "array-contains", safeProductId)
      .get();

    for (const doc of favoritesSnap.docs) {
      const userId = sanitizePlainText(doc.id, 128);
      const eventId = `favorite_promotion_${safeProductId}_${discount}_${userId}`;
      if (await hasAutomationEvent(db, eventId)) continue;

      const push = await sendCustomNotificationToUsers({
        userIds: [userId],
        title: `${safeProductName} entrou em promocao`,
        body: `${discount}% de desconto para uma peca que esta nos seus favoritos. Agora por ${currentPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`,
        link,
        data: {
          screen: "product",
          productId: safeProductId,
          type: "favorite_promotion"
        }
      });

      if (push.sent > 0) {
        await recordAutomationEvent(db, eventId, {
          userId,
          productId: safeProductId,
          type: "favorite_promotion",
          reference: String(discount)
        });
      }

      results.push({ type: "favoritePromotion", userId, sent: push.sent || 0 });
    }
  }

  if (operations.notificationRules.purchasePromotion) {
    const ordersSnap = await db.collection("pedidos")
      .where("productIds", "array-contains", safeProductId)
      .get();

    const uniqueUserIds = [...new Set(
      ordersSnap.docs
        .map((doc) => sanitizePlainText(doc.data()?.userId, 128))
        .filter(Boolean)
    )];

    for (const userId of uniqueUserIds) {
      const eventId = `purchase_promotion_${safeProductId}_${discount}_${userId}`;
      if (await hasAutomationEvent(db, eventId)) continue;

      const push = await sendCustomNotificationToUsers({
        userIds: [userId],
        title: `${safeProductName} esta com desconto`,
        body: `Uma peca que voce ja comprou entrou em promocao. Agora por ${currentPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`,
        link,
        data: {
          screen: "product",
          productId: safeProductId,
          type: "purchase_promotion"
        }
      });

      if (push.sent > 0) {
        await recordAutomationEvent(db, eventId, {
          userId,
          productId: safeProductId,
          type: "purchase_promotion",
          reference: String(discount)
        });
      }

      results.push({ type: "purchasePromotion", userId, sent: push.sent || 0 });
    }
  }

  return results;
}

async function notifyUsersForLowStock(db, product, operations) {
  const threshold = Number(operations.notificationRules.lowStockThreshold || 0);
  const inventory = getProductInventoryLevel(product);
  const safeProductId = sanitizePlainText(product?.id, 120);

  if (!operations.notificationRules.favoriteLowStock || !safeProductId || !threshold || inventory == null || inventory <= 0 || inventory > threshold) {
    return [];
  }

  const safeProductName = sanitizePlainText(product?.nome, 120) || "uma peca";
  const link = buildStorefrontProductLink(safeProductId);
  const favoritesSnap = await db.collection("usuarios")
    .where("favoritos", "array-contains", safeProductId)
    .get();

  const results = [];
  for (const doc of favoritesSnap.docs) {
    const userId = sanitizePlainText(doc.id, 128);
    const eventId = `favorite_low_stock_${safeProductId}_${inventory}_${userId}`;
    if (await hasAutomationEvent(db, eventId)) continue;

    const push = await sendCustomNotificationToUsers({
      userIds: [userId],
      title: `${safeProductName} esta acabando`,
      body: `Uma peca que voce favoritou esta com poucas unidades restantes.`,
      link,
      data: {
        screen: "product",
        productId: safeProductId,
        type: "favorite_low_stock"
      }
    });

    if (push.sent > 0) {
      await recordAutomationEvent(db, eventId, {
        userId,
        productId: safeProductId,
        type: "favorite_low_stock",
        reference: String(inventory)
      });
    }

    results.push({ type: "favoriteLowStock", userId, sent: push.sent || 0 });
  }

  return results;
}

async function processProductNotifications(db, operations) {
  const snapshot = await db.collection("pecas").get();
  const activeProducts = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((product) => sanitizePlainText(product?.status, 20).toLowerCase() === "active");

  const results = [];
  for (const product of activeProducts) {
    if (Number(product?.desconto || 0) > 0) {
      results.push(...(await notifyUsersForPromotion(db, product, operations)));
    }

    results.push(...(await notifyUsersForLowStock(db, product, operations)));
  }

  return results;
}

export async function runStoreAutomation({ trigger = "manual" } = {}) {
  const db = getAdminDb();
  const releaseLock = await acquireAutomationLock(db, trigger);
  const nowIso = new Date().toISOString();

  try {
    const operations = await getStoreOperations(db);
    const discountResult = await processDiscountSchedules(db, operations, nowIso);
    const collectionResult = await processCollectionSchedules(db, {
      ...operations,
      discountSchedules: discountResult.schedules
    }, nowIso);
    const notifications = await processProductNotifications(db, {
      ...operations,
      discountSchedules: discountResult.schedules,
      collectionSchedules: collectionResult.schedules
    });

    await db.collection("site_config").doc(STORE_OPERATIONS_DOC_ID).set({
      discountSchedules: discountResult.schedules,
      collectionSchedules: collectionResult.schedules,
      lastAutomationRunAt: nowIso,
      lastAutomationTrigger: sanitizePlainText(trigger, 120)
    }, { merge: true });

    return {
      ok: true,
      ranAt: nowIso,
      trigger: sanitizePlainText(trigger, 120),
      discounts: discountResult.results,
      collections: collectionResult.results,
      notifications
    };
  } finally {
    await releaseLock().catch(() => {});
  }
}
