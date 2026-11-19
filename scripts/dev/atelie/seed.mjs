// Copia o catalogo PUBLICO (somente leitura da producao) para o EMULADOR e cria contas de teste.
for (const k of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "GCLOUD_PROJECT"]) {
  if (!process.env[k]) { console.error(`Recusado: ${k} nao definido.`); process.exit(1); }
}
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const { getAdminDb, getAdminAuth } = await import(`${ROOT}/server/_firebase-admin.mjs`);
const { claimsForRole } = await import(`${ROOT}/server/_team-admin.mjs`);

function val(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)]));
  return null;
}
const r = await fetch("https://firestore.googleapis.com/v1/projects/site-lamed/databases/(default)/documents/pecas?pageSize=300&key=AIzaSyCzB4_YotWCPVh1yaqWkhbB4LypPQYvV4U");
const docs = (await r.json()).documents;
const db = getAdminDb();
const batch = db.batch();
for (const d of docs) batch.set(db.collection("pecas").doc(d.name.split("/").pop()), Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, val(v)])));
await batch.commit();
const auth = getAdminAuth();
const users = [["maria", "Maria Teste", "team"], ["joana", "Joana Teste", "production"], ["cliente", "Cliente Teste", null]];
for (const [u, name, role] of users) {
  const email = `${u}@producao.lamedvs.com.br`;
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch {}
  const user = await auth.createUser({ email, password: "senha-teste-123", displayName: name });
  if (role) await auth.setCustomUserClaims(user.uid, claimsForRole(role));
}
console.log(`semeado: ${docs.length} pecas, ${users.length} contas`);
process.exit(0);
