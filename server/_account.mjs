import { FieldValue, getAdminDb } from "./_firebase-admin.mjs";

class AccountRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AccountRequestError";
    this.status = status;
  }
}

function sanitizePlainText(value, maxLength = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizePhone(value) {
  return String(value ?? "")
    .replace(/[^\d+\-() ]/g, "")
    .trim()
    .slice(0, 30);
}

function normalizeDocument(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);
}

function normalizePostalCode(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 8);
}

function normalizeImageUrl(value) {
  const safe = String(value ?? "").trim().slice(0, 2000);
  if (!safe) return "";
  return /^https?:\/\//i.test(safe) ? safe : "";
}

function normalizeStateCode(value) {
  return String(value ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase()
    .slice(0, 2);
}

function splitCityAndState(cityValue, stateValue = "") {
  const safeState = normalizeStateCode(stateValue);
  const safeCity = sanitizePlainText(cityValue, 120);

  if (safeState || !safeCity.includes("/")) {
    return {
      cidade: safeCity,
      estado: safeState
    };
  }

  const [cityPart, statePart] = safeCity.split("/").map((item) => item.trim());
  return {
    cidade: sanitizePlainText(cityPart, 120),
    estado: normalizeStateCode(statePart)
  };
}

function normalizeProfileAddress(address) {
  if (!address || typeof address !== "object") return null;

  const cityState = splitCityAndState(address.cidade, address.estado);
  const normalized = {
    rua: sanitizePlainText(address.rua, 140),
    numero: sanitizePlainText(address.numero, 40),
    complemento: sanitizePlainText(address.complemento, 120),
    bairro: sanitizePlainText(address.bairro, 80),
    cidade: cityState.cidade,
    estado: cityState.estado,
    cep: normalizePostalCode(address.cep)
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
}

function sanitizeAddressId(value, fallback = "") {
  const normalized = sanitizePlainText(value, 80)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback || "";
}

function buildAddressSignature(address) {
  const normalized = normalizeProfileAddress(address);
  if (!normalized) return "";

  return [
    sanitizePlainText(normalized.rua, 140).toLowerCase(),
    sanitizePlainText(normalized.numero, 40).toLowerCase(),
    sanitizePlainText(normalized.complemento, 120).toLowerCase(),
    sanitizePlainText(normalized.bairro, 80).toLowerCase(),
    sanitizePlainText(normalized.cidade, 120).toLowerCase(),
    sanitizePlainText(normalized.estado, 2).toLowerCase(),
    normalizePostalCode(normalized.cep)
  ].join("|");
}

function extractProfileAddressFields(address) {
  const normalized = normalizeProfileAddress(address);
  if (!normalized) return null;
  return { ...normalized };
}

function normalizeSavedAddressEntry(address, index = 0) {
  const normalized = normalizeProfileAddress(address);
  if (!normalized) return null;

  return {
    id: sanitizeAddressId(address?.id, `address-${index + 1}`),
    label: sanitizePlainText(address?.label, 60),
    principal: address?.principal === true,
    ...normalized
  };
}

function normalizeSavedAddressBook(list, primaryAddress = null, primaryAddressId = "") {
  const sourceList = Array.isArray(list) ? list : [];
  const entries = sourceList
    .map((item, index) => normalizeSavedAddressEntry(item, index))
    .filter(Boolean)
    .slice(0, 10);

  const normalizedPrimary = normalizeProfileAddress(primaryAddress);
  let selectedId = sanitizeAddressId(primaryAddressId);

  if (!selectedId) {
    selectedId = entries.find((item) => item.principal)?.id || "";
  }

  if (normalizedPrimary) {
    const primarySignature = buildAddressSignature(normalizedPrimary);
    let primaryEntry = entries.find((item) => item.id === selectedId);

    if (!primaryEntry && primarySignature) {
      primaryEntry = entries.find((item) => buildAddressSignature(item) === primarySignature);
    }

    if (primaryEntry) {
      Object.assign(primaryEntry, normalizedPrimary);
      selectedId = primaryEntry.id;
    } else {
      selectedId = selectedId || `address-${entries.length + 1}`;
      entries.unshift({
        id: selectedId,
        label: "Endereco principal",
        principal: true,
        ...normalizedPrimary
      });
    }
  }

  const normalizedEntries = entries
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      id: sanitizeAddressId(item.id, `address-${index + 1}`),
      label: sanitizePlainText(item.label, 60),
      principal: false
    }));

  if (!selectedId) {
    selectedId = normalizedEntries[0]?.id || "";
  }

  const selectedEntry = normalizedEntries.find((item) => item.id === selectedId) || normalizedEntries[0] || null;

  if (selectedEntry) {
    selectedEntry.principal = true;
    if (!selectedEntry.label) {
      selectedEntry.label = "Endereco principal";
    }
  }

  normalizedEntries.forEach((item, index) => {
    if (!item.label) {
      item.label = item.principal ? "Endereco principal" : `Endereco salvo ${index + 1}`;
    }
  });

  return {
    enderecos: normalizedEntries,
    enderecoPrincipalId: selectedEntry?.id || null,
    endereco: extractProfileAddressFields(selectedEntry) || normalizedPrimary || null
  };
}

function normalizeFavoritesList(list) {
  if (!Array.isArray(list)) return [];

  return Array.from(new Set(
    list
      .map((item) => sanitizePlainText(item, 120))
      .filter(Boolean)
  )).slice(0, 200);
}

function getPersistedCreatedAt(value) {
  return value && typeof value.toDate === "function" ? value : null;
}

function normalizeAuthUser(authUser = {}) {
  return {
    displayName: sanitizePlainText(authUser.displayName || authUser.name, 120),
    email: sanitizePlainText(authUser.email, 120),
    photoURL: normalizeImageUrl(authUser.photoURL || authUser.picture)
  };
}

function mergeProfileAddressRecords(primaryAddress, fallbackAddress) {
  return normalizeProfileAddress(primaryAddress) || normalizeProfileAddress(fallbackAddress) || null;
}

function buildUserProfileRecord(source = {}, authUser = {}, overrides = {}) {
  const base = source && typeof source === "object" ? source : {};
  const extra = overrides && typeof overrides === "object" ? overrides : {};
  const authProfile = normalizeAuthUser(authUser);
  const createdAt = Object.prototype.hasOwnProperty.call(extra, "createdAt")
    ? extra.createdAt
    : getPersistedCreatedAt(base.createdAt);
  const addressBook = normalizeSavedAddressBook(
    extra.enderecos ?? base.enderecos,
    mergeProfileAddressRecords(extra.endereco, base.endereco),
    extra.enderecoPrincipalId ?? base.enderecoPrincipalId
  );

  return {
    nome: sanitizePlainText(extra.nome ?? base.nome ?? authProfile.displayName ?? authProfile.email?.split("@")[0] ?? "Cliente", 120) || "Cliente",
    email: sanitizePlainText(extra.email ?? base.email ?? authProfile.email, 120),
    telefone: sanitizePhone(extra.telefone ?? base.telefone),
    documento: normalizeDocument(extra.documento ?? base.documento),
    endereco: addressBook.endereco,
    enderecos: addressBook.enderecos,
    enderecoPrincipalId: addressBook.enderecoPrincipalId,
    fotoUrl: normalizeImageUrl(extra.fotoUrl ?? base.fotoUrl ?? authProfile.photoURL),
    createdAt: createdAt ?? null,
    favoritos: normalizeFavoritesList(extra.favoritos ?? base.favoritos)
  };
}

export function isAccountRequestError(error) {
  return error instanceof AccountRequestError;
}

export async function upsertUserProfile({ userId, authUser, input = {} }) {
  const safeUserId = sanitizePlainText(userId, 128);
  if (!safeUserId) {
    throw new AccountRequestError(401, "Sessao nao encontrada.");
  }

  const db = getAdminDb();
  const ref = db.collection("usuarios").doc(safeUserId);
  const snapshot = await ref.get();
  const existingData = snapshot.data() || {};
  const normalizedProfile = buildUserProfileRecord(existingData, authUser, {
    ...input,
    createdAt: snapshot.exists ? getPersistedCreatedAt(existingData.createdAt) : FieldValue.serverTimestamp()
  });

  await ref.set(normalizedProfile);

  return {
    ok: true,
    profile: {
      nome: normalizedProfile.nome,
      email: normalizedProfile.email,
      favoritesCount: Array.isArray(normalizedProfile.favoritos) ? normalizedProfile.favoritos.length : 0,
      addressCount: Array.isArray(normalizedProfile.enderecos) ? normalizedProfile.enderecos.length : 0
    }
  };
}

export async function toggleFavoriteForUser({ userId, authUser, productId, favorite = null }) {
  const safeUserId = sanitizePlainText(userId, 128);
  const safeProductId = sanitizePlainText(productId, 120);

  if (!safeUserId) {
    throw new AccountRequestError(401, "Sessao nao encontrada.");
  }

  if (!safeProductId) {
    throw new AccountRequestError(400, "Produto invalido para favoritar.");
  }

  const db = getAdminDb();
  const productSnapshot = await db.collection("pecas").doc(safeProductId).get();
  if (!productSnapshot.exists) {
    throw new AccountRequestError(404, "A peca escolhida nao foi encontrada.");
  }

  const ref = db.collection("usuarios").doc(safeUserId);
  const snapshot = await ref.get();
  const existingData = snapshot.data() || {};
  const currentFavorites = normalizeFavoritesList(existingData.favoritos);
  const alreadyFavorite = currentFavorites.includes(safeProductId);
  const nextFavoriteState = typeof favorite === "boolean" ? favorite : !alreadyFavorite;
  const nextFavorites = nextFavoriteState
    ? normalizeFavoritesList([...currentFavorites, safeProductId])
    : currentFavorites.filter((item) => item !== safeProductId);

  const normalizedProfile = buildUserProfileRecord(existingData, authUser, {
    favoritos: nextFavorites,
    createdAt: snapshot.exists ? getPersistedCreatedAt(existingData.createdAt) : FieldValue.serverTimestamp()
  });

  await ref.set(normalizedProfile);

  return {
    ok: true,
    productId: safeProductId,
    favorite: nextFavoriteState,
    favoritesCount: nextFavorites.length
  };
}
