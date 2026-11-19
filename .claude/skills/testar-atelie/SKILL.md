---
name: testar-atelie
description: Testa o Ateliê (área da equipe: estoque, peças, visitas) de ponta a ponta com os emuladores do Firebase, sem tocar em dados reais. Use depois de mexer em server/_atelie.mjs, server/_analytics.mjs, js/atelie.js, js/metricas.js, firestore.rules ou nas permissões da equipe.
---

# Testar o Ateliê com emuladores

Tudo roda local: Firestore + Auth emulados, servidor que liga `public/` às funções de `api/`.
Os scripts **recusam iniciar** sem as variáveis dos emuladores (proteção contra dados reais).

## Pré-requisitos
- Java 21 (o emulador do Firestore precisa). Se não houver no sistema, baixe um JRE portátil (Temurin) para uma pasta temporária e exporte `JAVA_HOME`/`PATH`.
- `firebase` CLI (`~/.npm-global/bin/firebase`), Chrome em `/usr/bin/google-chrome` (ou `CHROME_PATH`).
- `puppeteer-core` disponível para o teste de tela (instale numa pasta temporária, não no projeto).

## Passos (a partir de `scripts/dev/atelie/`)
1. `firebase emulators:start --only firestore,auth --project site-lamed` (em segundo plano; espere "All emulators ready").
2. Na raiz do projeto: `npm run build` (ou `LAMED_SKIP_IMAGES=1 npm run build` para ir rápido).
3. Exporte `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=site-lamed FIREBASE_PROJECT_ID=site-lamed`.
4. `node seed.mjs` — copia o catálogo público (só leitura) para o emulador e cria `maria` (team), `joana` (production), `cliente` (sem acesso); senha `senha-teste-123`.
5. `node devserver.mjs` (porta 4180, em segundo plano).
6. `node api.test.mjs` — permissões, movimentos, toque repetido, desfazer, concorrência, contador.
7. Crie o link `ln -s <pasta temporária>/node_modules node_modules` aqui (o git já ignora `node_modules`) e rode `node ui.test.mjs` — clique a clique no celular (390×844); capturas em `/tmp/atelie-shots/` (ou `SHOTS_DIR`). Olhe as capturas.

## Armadilhas já conhecidas
- A barra de aviso do emulador cobre as abas: `js/atelie.js` a desliga quando `window.LAMED_ATELIE_EMULADOR` está definido (o teste injeta).
- Cada pessoa precisa de um contexto de navegador separado (o login fica salvo).
- Respostas 400/403 no console são esperadas nos testes de senha errada e conta sem acesso.
