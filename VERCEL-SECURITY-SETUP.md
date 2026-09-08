# Vercel Security Setup

Checklist rapido para publicar este projeto com as protecoes novas.

## 1. Variaveis minimas na Vercel

Obrigatorias para pedidos via backend:

- `DIAGNOSTIC_TOKEN`
- `FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64`

Automacoes agendadas da loja:

- `CRON_SECRET` — obrigatoria para o Cron da Vercel chamar `/api/automation/run` com seguranca. O projeto agenda essa rota de hora em hora e processa retiradas de desconto e janelas de colecao que ja venceram. A Vercel envia esse valor no header `Authorization: Bearer <CRON_SECRET>` em cada execucao do Cron.

Alternativa ao Base64:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

Frete:

- `SHIPPING_API_ENABLED=false`

Se um dia o frete automatico voltar:

- `SHIPPING_PROVIDER`
- `CORREIOS_*` ou `MELHOR_ENVIO_*`

Notificacoes web, se ativadas:

- `FCM_WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_NOTIFICATION_ICON_URL`
- `WEB_PUSH_CLICK_BASE_URL`

## 2. Como gerar o env do Firebase Admin

Com o JSON da service account em maos:

```bash
node scripts/firebase-admin-env.mjs caminho/para/service-account.json
```

Use preferencialmente o valor de `FIREBASE_ADMIN_SERVICE_ACCOUNT_BASE64` na Vercel.

## 3. Como testar depois do deploy

Com o `DIAGNOSTIC_TOKEN` ja configurado:

```bash
curl -H "x-diagnostic-token: SEU_TOKEN" https://www.lamedvs.com.br/api/status
curl -H "x-diagnostic-token: SEU_TOKEN" https://www.lamedvs.com.br/api/shipping/health
```

Esperado:

- `api/status` nao deve abrir sem token
- `ordersConfigured` deve ficar `true`
- `firebaseAdmin.configured` deve ficar `true`

Para as automacoes, confirme no painel da Vercel que `CRON_SECRET` existe antes de depender da execucao automatica. O botao **Executar agora** no admin usa a sessao do administrador e continua funcionando independentemente do cron.

## 4. Bucket compartilhado

O prefixo `legacy-open/` continua publico para leitura, mas agora so aceita:

- imagens
- videos
- PDF
- ate 20 MB

Se o outro site usar outra pasta, ajuste `storage.rules` para o prefixo real antes do deploy.

## 5. Regra operacional

Toda mudanca nova deve seguir [SECURITY-GUARDRAILS.md](C:\Users\joaom\OneDrive\Documentos\sites\SECURITY-GUARDRAILS.md).
