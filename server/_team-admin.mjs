import { FieldValue, getAdminAuth, getAdminDb } from "./_firebase-admin.mjs";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
const ALLOWED_ROLES = new Set(["production", "admin"]);

function teamError(status, message) { const error = new Error(message); error.status = status; return error; }
function cleanUsername(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, ""); }
function internalEmail(username) { return `${username}@producao.lamedvs.com.br`; }
function claimsForRole(role) { return role === "admin" ? { admin: true, production: true, role: "admin" } : { production: true, role: "production" }; }
function publicMember(doc) { const data = doc.data(); return { id: doc.id, uid: data.uid || doc.id, name: data.name || "", username: data.username || "", role: data.role === "admin" ? "admin" : "production", disabled: data.disabled === true, createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null, updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null }; }
async function listMembers(db) { const snapshot = await db.collection("production_users").orderBy("name").get(); return snapshot.docs.map(publicMember); }

export async function applyTeamAdminAction({ action, payload, adminUid }) {
  const auth = getAdminAuth();
  const db = getAdminDb();
  if (action === "list") return { members: await listMembers(db) };

  if (action === "create") {
    const name = String(payload?.name || "").trim().slice(0, 100);
    const username = cleanUsername(payload?.username);
    const password = String(payload?.password || "");
    const role = ALLOWED_ROLES.has(payload?.role) ? payload.role : "production";
    if (name.length < 2) throw teamError(400, "Informe o nome da pessoa.");
    if (!USERNAME_PATTERN.test(username)) throw teamError(400, "Use um usuario com 3 a 30 letras, numeros, ponto, traco ou sublinhado.");
    if (password.length < 8) throw teamError(400, "A senha temporaria precisa ter pelo menos 8 caracteres.");
    let user;
    try { user = await auth.createUser({ email: internalEmail(username), password, displayName: name, disabled: false }); }
    catch (error) { if (error?.code === "auth/email-already-exists") throw teamError(400, "Este usuario ja esta cadastrado."); throw error; }
    try {
      await auth.setCustomUserClaims(user.uid, claimsForRole(role));
      await db.collection("production_users").doc(user.uid).set({ uid: user.uid, name, username, role, disabled: false, createdAt: FieldValue.serverTimestamp(), createdBy: adminUid, updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid });
    } catch (error) { await auth.deleteUser(user.uid).catch(() => {}); throw error; }
    return { members: await listMembers(db) };
  }

  const uid = String(payload?.uid || "").trim();
  if (!uid) throw teamError(400, "Conta nao informada.");
  if (uid === adminUid) throw teamError(400, "Voce nao pode alterar a propria conta por esta tela.");
  if (action === "status") {
    const disabled = payload?.disabled === true;
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);
    await db.collection("production_users").doc(uid).set({ disabled, updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid }, { merge: true });
    return { members: await listMembers(db) };
  }
  if (action === "password") {
    const password = String(payload?.password || "");
    if (password.length < 8) throw teamError(400, "A nova senha precisa ter pelo menos 8 caracteres.");
    await auth.updateUser(uid, { password });
    await db.collection("production_users").doc(uid).set({ passwordChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid }, { merge: true });
    return {};
  }
  if (action === "role") {
    const role = ALLOWED_ROLES.has(payload?.role) ? payload.role : "production";
    await auth.setCustomUserClaims(uid, claimsForRole(role));
    await auth.revokeRefreshTokens(uid);
    await db.collection("production_users").doc(uid).set({ role, updatedAt: FieldValue.serverTimestamp(), updatedBy: adminUid }, { merge: true });
    return { members: await listMembers(db) };
  }
  throw teamError(404, "Acao de equipe nao encontrada.");
}
