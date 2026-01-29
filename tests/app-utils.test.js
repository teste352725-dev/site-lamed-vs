const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appSource = fs.readFileSync(appJsPath, 'utf8');

function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`));
  if (!match) {
    throw new Error(`Função ${name} não encontrada em app.js`);
  }
  return match[0];
}

const context = {};
vm.createContext(context);

const isSudesteSource = extractFunction(appSource, 'isSudeste');
const isHanukahSource = extractFunction(appSource, 'isHanukahProduct');

vm.runInContext(`${isSudesteSource}\n${isHanukahSource}`, context);

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (esperado ${expected}, obtido ${actual})`);
  }
}

// isSudeste
assertEqual(context.isSudeste('01000-000'), true, 'CEP de SP deve ser Sudeste');
assertEqual(context.isSudeste('99000-000'), false, 'CEP do RS não deve ser Sudeste');
assertEqual(context.isSudeste(''), false, 'CEP vazio deve retornar false');
assertEqual(context.isSudeste('ABC'), false, 'CEP inválido deve retornar false');

// isHanukahProduct
assertEqual(context.isHanukahProduct({ nome: 'Kit Hanukah Tradicional' }), true, 'Hanukah deve ser reconhecido');
assertEqual(context.isHanukahProduct({ nome: 'Chanukiá de Mesa' }), true, 'Chanukiá deve ser reconhecido');
assertEqual(context.isHanukahProduct({ nome: 'Toalha Judaica' }), true, 'Judaica deve ser reconhecido');
assertEqual(context.isHanukahProduct({ nome: 'Mesa Posta' }), false, 'Produto sem termo deve retornar false');

console.log('Todos os testes de utilitários passaram.');
