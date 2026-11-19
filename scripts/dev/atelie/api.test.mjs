import assert from "node:assert/strict";
const BASE = "http://127.0.0.1:4180";
const UA = "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile";
let ok = 0; const fails = [];
async function check(name, fn) { try { await fn(); ok++; console.log("OK  ", name); } catch (e) { fails.push(name); console.log("FALHA", name, "-", e.message); } }

async function token(user) {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=teste", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${user}@producao.lamedvs.com.br`, password: "senha-teste-123", returnSecureToken: true }) });
  return (await r.json()).idToken;
}
async function call(tok, action, payload) {
  const r = await fetch(`${BASE}/api/admin/storefront/update`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ action: `atelie.${action}`, payload }) });
  return { status: r.status, body: await r.json() };
}
const id = () => crypto.randomUUID().replace(/-/g, "");

const maria = await token("maria"), joana = await token("joana"), cliente = await token("cliente");
const home = await call(maria, "inicio");
const peca = home.body.result.pecas.find((p) => p.variantes.length > 1 && p.variantes[0].cor);
const cor = peca.variantes[0].cor;
const base = { ...peca.variantes[0] };

await check("inicio: equipe recebe pecas, permissoes e visitas", async () => {
  assert.equal(home.status, 200);
  assert.ok(home.body.result.pecas.length > 50);
  assert.deepEqual(home.body.result.me.permissoes, { admin: false, estoque: true, pecas: true, visitas: true });
  assert.ok(home.body.result.visitas.hoje.visitas >= 1, "a visita do teste anterior contou");
});
await check("cliente comum e sem login sao barrados", async () => {
  assert.equal((await call(cliente, "inicio")).status, 403);
  assert.equal((await call("", "inicio")).status, 401);
  assert.equal((await call("token-falso", "inicio")).status, 401);
});
await check("produzir 3 e marcar 2 prontas", async () => {
  let r = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: 3, movimentoId: id() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "pronta", quantidade: 2, movimentoId: id() });
  const v = r.body.result.peca.variantes[0];
  assert.deepEqual([v.produzir, v.pronta], [Math.max(0, base.produzir + 3 - 2), base.pronta + 2]);
});
await check("toque repetido (mesmo id) nao duplica", async () => {
  const mid = id();
  const a = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: 1, movimentoId: mid });
  const b = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: 1, movimentoId: mid });
  assert.equal(b.body.result.repetido, true);
  assert.equal(b.body.result.peca.variantes[0].produzir, a.body.result.peca.variantes[0].produzir);
});
await check("venda com canal e desfazer", async () => {
  const before = (await call(maria, "inicio")).body.result;
  const v0 = before.pecas.find((p) => p.id === peca.id).variantes[0];
  const r = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "venda", quantidade: 1, canal: "instagram", movimentoId: id() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.result.movimento.descricao, /pelo Instagram/);
  assert.equal(r.body.result.peca.variantes[0].pronta, v0.pronta - 1);
  const after = (await call(maria, "inicio")).body.result;
  assert.equal(after.vendasSemana, before.vendasSemana + 1);
  const u = await call(maria, "estoque.desfazer", { movimentoId: r.body.result.movimento.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.body.result.peca.variantes[0].pronta, v0.pronta);
  assert.equal((await call(maria, "estoque.desfazer", { movimentoId: r.body.result.movimento.id })).body.code, "DESFEITO");
});
await check("outra pessoa nao desfaz o movimento da Maria", async () => {
  const r = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: 1, movimentoId: id() });
  assert.equal((await call(joana, "estoque.desfazer", { movimentoId: r.body.result.movimento.id })).status, 403);
});
await check("venda sem peca pronta pede confirmacao e baixa da producao", async () => {
  const fresh = (await call(maria, "inicio")).body.result.pecas.find((p) => p.id === peca.id).variantes[0];
  await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "ajuste", pronta: 0, produzir: 2, movimentoId: id() });
  const r = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "venda", quantidade: 1, movimentoId: id() });
  assert.equal(r.status, 409); assert.equal(r.body.code, "SEM_PRONTA");
  const r2 = await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "venda", quantidade: 1, origem: "producao", movimentoId: id() });
  assert.deepEqual([r2.body.result.peca.variantes[0].pronta, r2.body.result.peca.variantes[0].produzir], [0, 1]);
  await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "ajuste", pronta: fresh.pronta, produzir: fresh.produzir, movimentoId: id() });
});
await check("10 movimentos ao mesmo tempo nao perdem nenhum (concorrencia)", async () => {
  const start = (await call(maria, "inicio")).body.result.pecas.find((p) => p.id === peca.id).variantes[0].produzir;
  await Promise.all(Array.from({ length: 10 }, (_, i) => call(i % 2 ? maria : joana, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: 1, movimentoId: id() })));
  const end = (await call(maria, "inicio")).body.result.pecas.find((p) => p.id === peca.id).variantes[0].produzir;
  assert.equal(end, start + 10);
});
await check("outros campos das cores continuam intactos", async () => {
  const d = (await call(maria, "inicio")).body.result.pecas.find((p) => p.id === peca.id);
  assert.equal(d.variantes.length, peca.variantes.length);
  assert.equal(d.variantes[1].pronta, peca.variantes[1].pronta);
  assert.equal(d.variantes[0].hex, peca.variantes[0].hex);
});
await check("Joana (somente estoque) nao altera nome/preco; Maria altera", async () => {
  assert.equal((await call(joana, "peca.editar", { productId: peca.id, preco: 1 })).status, 403);
  const r = await call(maria, "peca.editar", { productId: peca.id, nome: peca.nome + " Teste", preco: "1.234,50", status: "inactive" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result.peca.preco, 1234.5);
  assert.equal(r.body.result.peca.status, peca.status, "status nao pode ser alterado por aqui");
  await call(maria, "peca.editar", { productId: peca.id, nome: peca.nome, preco: peca.preco });
});
await check("entradas invalidas sao recusadas", async () => {
  assert.equal((await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: -5, movimentoId: id() })).status, 400);
  assert.equal((await call(maria, "estoque.mover", { productId: peca.id, cor: "Cor Inexistente", tipo: "produzir", quantidade: 1, movimentoId: id() })).status, 404);
  assert.equal((await call(maria, "estoque.mover", { productId: "../usuarios/x", cor, tipo: "produzir", quantidade: 1, movimentoId: id() })).status, 400);
  assert.equal((await call(maria, "estoque.mover", { productId: peca.id, cor, tipo: "produzir", quantidade: 1, movimentoId: "curto" })).status, 400);
  assert.equal((await call(maria, "peca.editar", { productId: peca.id, preco: "0" })).status, 400);
  assert.equal((await call(maria, "acao.inexistente", {})).status, 404);
});
await check("contador: robos e ids falsos ignorados; peca real conta", async () => {
  const send = (body, ua = UA) => fetch(`${BASE}/api/eventos`, { method: "POST", headers: { "user-agent": ua, "content-type": "text/plain" }, body: JSON.stringify(body) });
  const before = (await call(maria, "inicio")).body.result.visitas;
  await send({ t: "visita" }, "Googlebot/2.1");
  await send({ t: "produto", id: "naoexiste123" });
  await send({ t: "produto", id: peca.id });
  await send({ t: "whatsapp", o: "produto", id: peca.id });
  const after = (await call(maria, "inicio")).body.result.visitas;
  assert.equal(after.hoje.visitas, before.hoje.visitas, "robo nao conta");
  assert.equal(after.hoje.whatsapp, before.hoje.whatsapp + 1);
  assert.ok(after.maisVistas.some((x) => x.id === peca.id && x.nome === peca.nome));
  assert.ok(after.maisWhatsapp.some((x) => x.id === peca.id));
});
console.log(`\n${ok} ok, ${fails.length} falha(s)`);
process.exit(fails.length ? 1 : 0);
