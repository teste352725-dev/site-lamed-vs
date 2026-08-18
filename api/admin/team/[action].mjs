import { FieldValue, getAdminAuth, getAdminDb } from "../../../server/_firebase-admin.mjs";
import { isSessionRequestError, requireAdminUser } from "../../../server/_session.mjs";
import { getRequestBody, setNoStore } from "../../../server/_shipping.mjs";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
const ALLOWED_ROLES = new Set(["production", "admin"]);

function cleanUsername(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function internalEmail(username) {
  return `${username}@producao.lamedvs.com.br`;
}

function publicMember(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    uid: data.uid || doc.id,
    name: data.name || "",
    username: data.username || "",
    role: data.role === "admin" ? "admin" : "production",
    disabled: data.disabled === true,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null
  };
}

function claimsForRole(role) {
  return role === "admin"
    ? { admin: true, production: true, role: "admin" }
    : { production: true, role: "production" };
}

async function listMembers(db) {
  const snapshot = await db.collection("production_users").orderBy("name").get();
  return snapshot.docs.map(publicMember);
}

export default async function handler(req, res) {
  setNoStore(res);
  const action = String(req.query?.action || "").toLowerCase();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Metodo nao permitido." });
  }

  try {
    const authorizationHeader = req.headers?.authorization || req.headers?.Authorization || "";
    const adminUser = await requireAdminUser(authorizationHeader);
    const body = getRequestBody(req);
    const auth = getAdminAuth();
    const db = getAdminDb();

    if (action === "list") {
      return res.status(200).json({ ok: true, members: await listMembers(db) });
    }

    if (action === "create") {
      const name = String(body?.name || "").trim().slice(0, 100);
      const username = cleanUsername(body?.username);
      const password = String(body?.password || "");
      const role = ALLOWED_ROLES.has(body?.role) ? body.role : "production";

      if (name.length < 2) return res.status(400).json({ ok: false, error: "Informe o nome da pessoa." });
      if (!USERNAME_PATTERN.test(username)) return res.status(400).json({ ok: false, error: "Use um usuario com 3 a 30 letras, numeros, ponto, traco ou sublinhado." });
      if (password.length < 8) return res.status(400).json({ ok: false, error: "A senha temporaria precisa ter pelo menos 8 caracteres." });

      const user = await auth.createUser({
        email: internalEmail(username),
        password,
        displayName: name,
        disabled: false
      });

      try {
        await auth.setCustomUserClaims(user.uid, claimsForRole(role));
        await db.collection("production_users").doc(user.uid).set({
          uid: user.uid,
          name,
          username,
          role,
          disabled: false,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: adminUser.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: adminUser.uid
        });
      } catch (error) {
        await auth.deleteUser(user.uid).catch(() => {});
        throw error;
      }

      return res.status(201).json({ ok: true, members: await listMembers(db) });
    }

    const uid = String(body?.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "Conta nao informada." });
    if (uid === adminUser.uid) return res.status(400).json({ ok: false, error: "Voce nao pode alterar a propria conta por esta tela." });

    if (action === "status") {
      const disabled = body?.disabled === true;
      await auth.updateUser(uid, { disabled });
      if (disabled) await auth.revokeRefreshTokens(uid);
      await db.collection("production_users").doc(uid).set({
        disabled,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid
      }, { merge: true });
      return res.status(200).json({ ok: true, members: await listMembers(db) });
    }

    if (action === "password") {
      const password = String(body?.password || "");
      if (password.length < 8) return res.status(400).json({ ok: false, error: "A nova senha precisa ter pelo menos 8 caracteres." });
      await auth.updateUser(uid, { password });
      await db.collection("production_users").doc(uid).set({
        passwordChangedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid
      }, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (action === "role") {
      const role = ALLOWED_ROLES.has(body?.role) ? body.role : "production";
      await auth.setCustomUserClaims(uid, claimsForRole(role));
      await auth.revokeRefreshTokens(uid);
      await db.collection("production_users").doc(uid).set({
        role,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: adminUser.uid
      }, { merge: true });
      return res.status(200).json({ ok: true, members: await listMembers(db) });
    }

    return res.status(404).json({ ok: false, error: "Acao nao encontrada." });
  } catch (error) {
    if (isSessionRequestError(error)) {
      return res.status(Number(error.status) || 401).json({ ok: false, error: error.message });
    }

    const knownErrors = {
      "auth/email-already-exists": "Este usuario ja esta cadastrado.",
      "auth/user-not-found": "Esta conta nao foi encontrada.",
      "auth/invalid-password": "A senha informada nao e valida."
    };
    const message = knownErrors[error?.code];
    if (message) return res.status(400).json({ ok: false, error: message });

    console.error("[vercel.admin.team]", error);
    return res.status(500).json({ ok: false, error: "Nao foi possivel concluir esta operacao agora." });
  }
}
