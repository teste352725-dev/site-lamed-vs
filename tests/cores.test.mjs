import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(readFileSync(new URL("../js/paleta-cores.js", import.meta.url), "utf8"), context);
const P = context.window.LamedPaleta;

test("paleta: nomes corrigidos e tom padrão", () => {
  const casos = {
    "Perola": "Pérola",
    "Branca": "Branco",
    "Off-White": "Off-white",
    "Azul Marinho": "Azul-marinho",
    "Dourados": "Dourado",
    "preto com bordados dourado": "Preto com bordado dourado",
    "Pérola com Bordados dourados": "Pérola com bordado dourado",
    "Perola com Bordado Dourado": "Pérola com bordado dourado",
    "Areia com  Bordado dourado": "Areia com bordado dourado",
    "‎Azul com bordado prata": "Azul com bordado prata",
    "Azul com Bordados prata": "Azul com bordado prata",
    "Pérola com borda Dourada": "Pérola com borda dourada",
    "Marsala com arabesco prata": "Marsala com arabesco prata",
    "Guardanapo Estrela de Davi azul": "Azul",
    "Cinza com verde": "Cinza com bordado verde"
  };
  for (const [de, para] of Object.entries(casos)) assert.equal(P.padronizar(de)?.nome, para, de);
  assert.equal(P.padronizar("Verde").hex, "#396441");
  assert.equal(P.padronizar("Verde com bordado dourado").hex, "#396441", "detalhe usa o tom do tecido");
  assert.equal(P.padronizar("Cinza com verde").inferido, true);
  assert.equal(P.padronizar("Terracota"), null, "cor fora da paleta fica como está");
  assert.equal(P.padronizar("Azul com estampa floral"), null);
});

test("paleta: padronizar duas vezes não muda nada", () => {
  for (const cor of P.PALETA) {
    for (const acabamento of ["", "bordado", "arabesco", "borda"]) {
      for (const detalhe of P.DETALHES) {
        const nome = P.montarNome(cor.nome, acabamento, detalhe);
        assert.equal(P.padronizar(nome)?.nome, nome, nome);
      }
    }
  }
  assert.equal(P.montarNome("Pérola", "borda", "preto"), "Pérola com borda preta");
  assert.equal(P.montarNome("Pérola", "bordado", "preto"), "Pérola com bordado preto");
});
