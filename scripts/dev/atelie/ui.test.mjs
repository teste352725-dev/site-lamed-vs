import puppeteer from "puppeteer-core";
const BASE = "http://127.0.0.1:4180";
const SHOTS = process.env.SHOTS_DIR || "/tmp/atelie-shots/";
import { mkdirSync } from "node:fs"; mkdirSync(SHOTS, { recursive: true });
let ok = 0; const fails = []; const errors = [];
const check = (name, cond, extra = "") => { if (cond) { ok++; console.log("OK  ", name); } else { fails.push(name); console.log("FALHA", name, extra); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox"] });
async function phone() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36" });
  await page.evaluateOnNewDocument(() => { window.LAMED_ATELIE_EMULADOR = "http://127.0.0.1:9099"; });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return page;
}
const shot = (page, name) => page.screenshot({ path: SHOTS + name + ".png" });
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => "");
const visible = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight) && getComputedStyle(e).visibility !== "hidden").catch(() => false);
async function login(page, user, pass = "senha-teste-123") {
  await page.goto(BASE + "/atelie", { waitUntil: "networkidle2" });
  await page.waitForSelector('[data-view="entrar"]', { timeout: 15000 });
  await page.type("#entrar-usuario", user);
  await page.type("#entrar-senha", pass);
  await page.tap("#entrar-botao");
}

// ---------------- Maria (estoque e pecas)
const p = await phone();
await login(p, "maria", "errada");
await p.waitForFunction(() => document.querySelector("#entrar-erro").textContent.length > 0, { timeout: 10000 });
check("senha errada mostra mensagem clara", (await text(p, "#entrar-erro")) === "Usuário ou senha incorretos.");
await shot(p, "01-entrar");
await p.$eval("#entrar-senha", (e) => { e.value = ""; });
await p.$eval("#entrar-usuario", (e) => { e.value = ""; });
await p.type("#entrar-usuario", "Maria");
await p.type("#entrar-senha", "senha-teste-123");
await p.tap("#entrar-botao");
await p.waitForSelector('[data-view="area"]', { timeout: 15000 });
await sleep(400);
check("entra com usuario em maiuscula e saudacao com o nome", /Maria$/.test(await text(p, "#titulo-inicio")), await text(p, "#titulo-inicio"));
check("visitas de hoje aparecem", /^\d+$/.test(await text(p, "#v-hoje")));
check("celular marcado como da equipe (nao conta visita)", await p.evaluate(() => localStorage.getItem("lamed_equipe") === "1"));
await shot(p, "02-inicio");
await p.evaluate(() => window.scrollTo(0, 99999)); await sleep(200); await shot(p, "03-inicio-fim");

await p.tap('[data-aba="estoque"]'); await sleep(200);
const nMesa = await p.$$eval("#lista-estoque [data-abrir]", (l) => l.length);
check("estoque abre filtrado em mesa posta", nMesa > 20, String(nMesa));
await shot(p, "04-estoque");
await p.type("#busca-estoque", "chama guardanapo");
await sleep(150);
const found = await p.$$eval("#lista-estoque [data-abrir]", (l) => l.map((b) => b.textContent));
check("busca encontra a peca (palavras em qualquer ordem)", found.length >= 1 && /Chama/i.test(found[0]), (await p.$eval("#busca-estoque", (e) => e.value)) + " " + JSON.stringify(found).slice(0, 120));
await p.tap("#lista-estoque [data-abrir]");
await p.waitForSelector("#folha-peca:not([hidden])");
await sleep(300);
await shot(p, "05-peca-cores");
const n0 = await p.$$eval("#folha-peca-cores .cor .numero__valor", (l) => l.map((e) => Number(e.textContent)));
await p.tap('#folha-peca-cores [data-mov="produzir"][data-var="0"]');
await p.waitForSelector("#folha-mov:not([hidden])");
await p.tap('[data-qtd-set="5"]');
await shot(p, "06-produzir");
await p.tap("#mov-confirmar");
await p.waitForSelector("#folha-mov[hidden]", { timeout: 10000 });
await sleep(200);
const n1 = await p.$$eval("#folha-peca-cores .cor .numero__valor", (l) => l.map((e) => Number(e.textContent)));
check("+5 em producao aparece na hora", n1[0] === n0[0] + 5, `${n0[0]} -> ${n1[0]}`);
check("aviso com Desfazer aparece", await visible(p, "#aviso-desfazer"));
await shot(p, "07-aviso");
await p.tap("#aviso-desfazer");
await p.waitForFunction(() => document.querySelector("#aviso-texto").textContent === "Desfeito.", { timeout: 10000 });
const n2 = await p.$$eval("#folha-peca-cores .cor .numero__valor", (l) => l.map((e) => Number(e.textContent)));
check("Desfazer volta o numero", n2[0] === n0[0], `${n2[0]} vs ${n0[0]}`);

// ficou pronta 1 -> venda pelo Instagram
await p.tap('#folha-peca-cores [data-mov="pronta"][data-var="0"]');
await p.waitForSelector("#folha-mov:not([hidden])");
await p.tap("#mov-confirmar");
await p.waitForSelector("#folha-mov[hidden]", { timeout: 10000 });
await p.tap('#folha-peca-cores [data-mov="venda"][data-var="0"]');
await p.waitForSelector("#folha-mov:not([hidden])");
check("venda mostra os canais", await visible(p, "#mov-canal"));
await p.tap('#mov-canal input[value="instagram"] + span');
await sleep(350);
await shot(p, "08-venda");
await p.tap("#mov-confirmar");
await p.waitForSelector("#folha-mov[hidden]", { timeout: 10000 });
check("aviso descreve a venda pelo Instagram", /pelo Instagram/.test(await text(p, "#aviso-texto")), await text(p, "#aviso-texto"));

// corrigir numeros
await p.tap('#folha-peca-cores [data-mov="ajuste"][data-var="0"]');
await p.waitForSelector("#folha-mov:not([hidden])");
await p.$eval("#ajuste-pronta", (e) => { e.value = ""; });
await p.type("#ajuste-pronta", "7");
await p.tap("#mov-confirmar");
await p.waitForSelector("#folha-mov[hidden]", { timeout: 10000 }).catch(async () => { await shot(p, "erro-ajuste"); console.log("ERRO AJUSTE:", await text(p, "#mov-erro"), await p.evaluate(() => [...document.querySelectorAll("#form-mov input")].filter((i) => !i.checkValidity()).map((i) => i.id + "=" + i.value + " " + i.validationMessage))); });
const n3 = await p.$$eval("#folha-peca-cores .cor .numero__valor", (l) => l.map((e) => Number(e.textContent)));
check("corrigir numeros grava a contagem", n3[1] === 7, String(n3));
await p.tap("#folha-peca .folha__fechar");
await sleep(150);

// pecas: editar preco
await p.tap('[data-aba="pecas"]'); await sleep(200);
await shot(p, "09-pecas");
await p.type("#busca-pecas", "guardanapo chama");
await sleep(150);
await p.tap("#lista-pecas [data-editar]");
await p.waitForSelector("#folha-editar:not([hidden])");
const precoAntes = await p.$eval("#editar-preco", (e) => e.value);
await p.$eval("#editar-preco", (e) => { e.value = ""; });
await p.type("#editar-preco", "99,90");
await shot(p, "10-editar");
await p.tap("#editar-salvar");
await p.waitForSelector("#folha-editar[hidden]", { timeout: 10000 });
check("preco salvo aparece na lista", /99,90/.test(await text(p, "#lista-pecas [data-editar] .peca__preco")), await text(p, "#lista-pecas [data-editar] .peca__preco"));
// volta o preco original
await p.tap("#lista-pecas [data-editar]");
await p.waitForSelector("#folha-editar:not([hidden])");
await p.$eval("#editar-preco", (e, v) => { e.value = v; }, precoAntes);
await p.tap("#editar-salvar");
await p.waitForSelector("#folha-editar[hidden]", { timeout: 10000 });

// inicio mostra os movimentos
await p.tap('[data-aba="inicio"]'); await sleep(200);
const movs = await p.$$eval("#ultimos-movimentos li", (l) => l.map((e) => e.textContent));
check("ultimos movimentos listam com o nome de quem fez", movs.length >= 3 && movs.some((m) => /Maria/.test(m)), movs.slice(0, 2).join(" | "));
check("movimento desfeito fica marcado", movs.some((m) => /desfeito/.test(m)));
// layout
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
check("sem rolagem horizontal no celular", overflow <= 0, String(overflow));
const small = await p.evaluate(() => [...document.querySelectorAll("button:not([hidden]), .aba")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim()).slice(0, 5));
check("botoes com altura boa para o dedo (>= 40px)", small.length === 0, JSON.stringify(small));
await p.tap("#botao-sair");
await p.waitForSelector('[data-view="entrar"]', { timeout: 10000 });
check("Sair volta para a tela de entrar", true);
await p.close();

// ---------------- Joana (somente estoque)
const j = await phone();
await login(j, "joana");
await j.waitForSelector('[data-view="area"]', { timeout: 15000 });
check("Joana nao ve a aba Pecas", !(await visible(j, '[data-aba="pecas"]')));
check("Joana ve a aba Estoque", await visible(j, '[data-aba="estoque"]'));
await j.close();

// ---------------- cliente comum
const c = await phone();
await login(c, "cliente");
await c.waitForFunction(() => /não tem acesso/.test(document.querySelector("#entrar-erro").textContent), { timeout: 15000 }).catch(() => {});
check("conta sem permissao e barrada com explicacao", /não tem acesso/.test(await text(c, "#entrar-erro")), await text(c, "#entrar-erro"));
await c.close();

check("nenhum erro de JavaScript", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
console.log(`\n${ok} ok, ${fails.length} falha(s)`);
process.exit(fails.length ? 1 : 0);
