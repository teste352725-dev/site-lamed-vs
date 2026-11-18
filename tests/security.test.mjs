import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeTokenEquals } from "../server/_security.mjs";
import { hasDiagnosticAccess } from "../server/_diagnostics.mjs";

const req = (headers) => ({ headers });
const VERCEL_ENV = { VERCEL: "1", DIAGNOSTIC_TOKEN: "segredo-de-teste" };

test("safeTokenEquals compara corretamente e rejeita vazios", () => {
  assert.equal(safeTokenEquals("abc", "abc"), true);
  assert.equal(safeTokenEquals("abc", "abd"), false);
  assert.equal(safeTokenEquals("abc", "abcd"), false);
  assert.equal(safeTokenEquals("", ""), false);
  assert.equal(safeTokenEquals(undefined, "abc"), false);
  assert.equal(safeTokenEquals("abc", undefined), false);
});

test("diagnostico: Origin/X-Forwarded-For falsos NAO liberam acesso na Vercel", () => {
  assert.equal(hasDiagnosticAccess(req({ origin: "http://localhost" }), VERCEL_ENV), false);
  assert.equal(hasDiagnosticAccess(req({ "x-forwarded-for": "127.0.0.1" }), VERCEL_ENV), false);
  assert.equal(hasDiagnosticAccess(req({ "x-real-ip": "::1" }), VERCEL_ENV), false);
  assert.equal(hasDiagnosticAccess(req({ host: "localhost" }), VERCEL_ENV), false);
});

test("diagnostico: token correto libera; token errado nao", () => {
  assert.equal(hasDiagnosticAccess(req({ "x-diagnostic-token": "segredo-de-teste" }), VERCEL_ENV), true);
  assert.equal(hasDiagnosticAccess(req({ "x-diagnostic-token": "errado" }), VERCEL_ENV), false);
});

test("diagnostico: atalho localhost so funciona fora da Vercel", () => {
  assert.equal(hasDiagnosticAccess(req({ host: "localhost:3000" }), {}), true);
  assert.equal(hasDiagnosticAccess(req({ host: "www.lamedvs.com.br" }), {}), false);
});

test("storage.rules: nenhuma pasta aceita escrita anonima nem listagem publica", () => {
  const rules = readFileSync(new URL("../storage.rules", import.meta.url), "utf8");
  assert.doesNotMatch(rules, /isSafeLegacyUpload/);
  assert.doesNotMatch(rules, /allow read: if true/, "use get publico + list restrito ao admin");
  for (const line of rules.split("\n").filter((l) => l.includes("allow write"))) {
    assert.match(line, /isAdmin\(\)|isOwnProfileImage|if false/, `escrita sem autenticacao: ${line.trim()}`);
  }
  assert.equal((rules.match(/allow list: if isAdmin\(\);/g) || []).length, 5);
});

test("firestore.rules: pedidos so sao criados pelo servidor e dados sensiveis exigem login", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/pedidos\/\{pedidoId\} \{\s*allow create: if false;/);
  assert.match(rules, /match \/precificacoes\/\{document=\*\*\} \{\s*allow read, write: if isAdmin\(\);/);
  assert.match(rules, /match \/shopping_carts\/\{userId\} \{\s*allow read, write: if false;/);
});

test("firestore.rules: log de auditoria do painel e somente inclusao e exclusivo do admin", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const block = rules.match(/match \/operacoes_logs\/\{logId\} \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(block, /allow read: if isAdmin\(\);/);
  assert.match(block, /allow create: if isAdmin\(\) &&/);
  assert.match(block, /allow update, delete: if false;/);
});

// --- Correcoes da auditoria formal de 2026-11-06 ---

function createFakeDb(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs));
  const snapshotOf = (path) => ({
    exists: docs.has(path),
    id: path.split("/").pop(),
    data: () => (docs.has(path) ? { ...docs.get(path) } : undefined)
  });
  const write = (path, data, options) => {
    docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...data } : { ...data });
  };
  const db = {
    docs,
    collection: (name) => ({
      doc: (id) => {
        const path = `${name}/${id}`;
        return {
          path,
          get: async () => snapshotOf(path),
          set: async (data, options) => write(path, data, options)
        };
      }
    }),
    runTransaction: async (callback) => {
      const pending = [];
      const result = await callback({
        get: async (ref) => snapshotOf(ref.path),
        set: (ref, data, options) => { pending.push([ref.path, data, options]); }
      });
      pending.forEach(([path, data, options]) => write(path, data, options));
      return result;
    }
  };
  return db;
}

test("InfinitePay: o mesmo pagamento (transaction_nsu) nao quita dois pedidos", async () => {
  const { applyInfinitePayWebhook } = await import("../server/_infinitepay.mjs");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, paid: true, amount: 10000, capture_method: "pix" })
  });

  try {
    const pending = { status: "pendente", paymentStatus: "pending", totalCentavos: 10000, total: 100 };
    const db = createFakeDb({ "pedidos/pedidoA": { ...pending }, "pedidos/pedidoB": { ...pending } });
    const event = (orderId) => ({ order_nsu: orderId, invoice_slug: "fatura-1", transaction_nsu: "NSU-UNICO" });

    const first = await applyInfinitePayWebhook(event("pedidoA"), db);
    assert.equal(first.paymentStatus, "paid");

    await assert.rejects(() => applyInfinitePayWebhook(event("pedidoB"), db), (error) => error.status === 409);
    assert.equal(db.docs.get("pedidos/pedidoB").paymentStatus, "pending");

    const repeated = await applyInfinitePayWebhook(event("pedidoA"), db);
    assert.equal(repeated.paymentStatus, "paid");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pedido duplicado: so o dono logado reaproveita o pedido e sem metadata", () => {
  const source = readFileSync(new URL("../server/_orders.mjs", import.meta.url), "utf8");
  assert.match(source, /paymentGateway === "infinitepay" && existingCheckoutUrl && canRevealDuplicateId/);
  assert.match(source, /const \{ metadata: _metadata, fingerprint: _fingerprint, \.\.\.reusedPublicOrder \} = duplicatedOrder;/);
  assert.doesNotMatch(source, /order: duplicatedOrder,/);
});

test("chat: envio de cliente tem limite de mensagens", () => {
  const source = readFileSync(new URL("../api/chat/send.mjs", import.meta.url), "utf8");
  assert.match(source, /enforceInMemoryRateLimit\(\{\s*key: `chat:send:/);
});

test("telas: dados vindos do banco sao escapados antes de innerHTML", () => {
  const userJs = readFileSync(new URL("../user.js", import.meta.url), "utf8");
  assert.match(userJs, /const userName = safeHtmlText\(chat\.userName/);
  assert.match(userJs, /const lastMessage = safeHtmlText\(chat\.lastMessage/);
  assert.match(userJs, /const cor = safeHtmlText\(item\?\.cor\?\.nome, 40\);/);

  const cartJs = readFileSync(new URL("../js/app-cart-checkout.js", import.meta.url), "utf8");
  assert.match(cartJs, /\$\{item\.cor \? ` \| \$\{escapeHtml\(item\.cor\.nome\)\}` : ''\}/);
  assert.match(cartJs, /<strong>\$\{cor\}<\/strong>/);
  assert.match(cartJs, /const cor = escapeHtml\(selection\?\.cor\?\.nome \|\| '-'\);/);
});

test("escapeHtml do user.js neutraliza a carga usada na auditoria", async () => {
  const userJs = readFileSync(new URL("../user.js", import.meta.url), "utf8");
  const start = userJs.indexOf("function sanitizePlainText(");
  const end = userJs.indexOf("function sanitizePhone(");
  const helpers = new Function(`${userJs.slice(start, end)}; return { safeHtmlText };`)();
  const payload = '<img src=x onerror="alert(1)">';
  const escaped = helpers.safeHtmlText(payload, 120);
  assert.equal(escaped.includes("<"), false);
  assert.equal(escaped.includes('"'), false);
  assert.equal(escaped, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});
