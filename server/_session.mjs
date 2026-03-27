import { getAdminAuth } from "./_firebase-admin.mjs";

const ADMIN_UIDS = new Set(["NoGsCqiKc0VJwWb6rppk7QVLV1B2"]);

class SessionRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SessionRequestError";
    this.status = status;
  }
}

export function isSessionRequestError(error) {
  return error instanceof SessionRequestError;
}

export async function resolveAuthenticatedUser(authorizationHeader) {
  const rawHeader = String(authorizationHeader || "").trim();
  if (!rawHeader) {
    throw new SessionRequestError(401, "Sessao nao encontrada.");
  }

  const match = rawHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new SessionRequestError(401, "Token de autenticacao invalido.");
  }

  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch (error) {
    throw new SessionRequestError(401, "Nao foi possivel validar sua sessao. Entre novamente e tente de novo.");
  }
}

export async function resolveAuthenticatedUserId(authorizationHeader) {
  const decoded = await resolveAuthenticatedUser(authorizationHeader);
  return decoded?.uid || null;
}

export function isAdminDecodedToken(decodedToken) {
  return Boolean(
    decodedToken?.uid && (
      ADMIN_UIDS.has(decodedToken.uid) ||
      decodedToken.admin === true
    )
  );
}

export async function requireAdminUser(authorizationHeader) {
  const decoded = await resolveAuthenticatedUser(authorizationHeader);
  if (!isAdminDecodedToken(decoded)) {
    throw new SessionRequestError(403, "Esta operacao exige permissao administrativa.");
  }

  return decoded;
}
