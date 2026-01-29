# Integração Efí Bank (Pix + Cartão)

Este projeto possui um backend Node para criar cobranças Pix e cartão via Efí.

## Pré-requisitos
- Conta Efí ativa (ambiente de produção ou sandbox).
- Certificado mTLS da Efí.
- Client ID e Client Secret.
- Chave Pix cadastrada na Efí.

## Variáveis de ambiente (backend/.env)
```
EFI_BASE_URL=https://pix-h.api.efipay.com.br
EFI_CLIENT_ID=seu_client_id
EFI_CLIENT_SECRET=seu_client_secret
EFI_PIX_KEY=sua_chave_pix
EFI_CERT_PATH=/caminho/para/certificado.p12
EFI_CERT_PASSPHRASE=sua_senha_se_houver
# ou
EFI_CERT_BASE64=base64_do_certificado
```

> Para produção, use o endpoint oficial de produção da Efí no `EFI_BASE_URL`.

## Como rodar o backend local
```
cd backend
npm install
npm run dev
```

## Ajuste do front-end
O front-end aponta para `/api/efi` por padrão. Se seu backend estiver em outro domínio, ajuste:
```
window.EFI_BACKEND_URL = 'https://seu-backend.com/api/efi';
```

## Dica para testes no Replit
Se acessar a URL raiz do Replit e aparecer `Cannot GET /`, isso é esperado: o backend não serve página inicial.
Use o endpoint de saúde para validar se está online:
```
https://seu-replit.replit.app/api/efi/health
```
O aviso de **Content Security Policy** no console do navegador costuma vir do próprio embed do Replit e não impede o funcionamento do backend.
Se aparecer o erro `does not provide an export named ...`, verifique se o seu `package.json` está com `"type": "module"` para que os arquivos `services/*.js` sejam interpretados como ES Modules.

## Hospedagem recomendada (seu site está na Vercel)
- **Front-end**: continue hospedando na **Vercel** (ótimo para site estático).
- **Backend Efí**: **Firebase Functions** (você pediu essa opção).
  - Ela funciona bem com Firestore/Auth e mantém o backend separado do front-end.

## Firebase Functions (passo a passo)
1. Instale o CLI do Firebase (uma vez):
   ```
   npm install -g firebase-tools
   ```
2. Faça login e selecione o projeto:
   ```
   firebase login
   firebase use --add
   ```
3. Configure as variáveis de ambiente (sandbox):
   ```
   firebase functions:config:set efi.base_url="https://pix-h.api.efipay.com.br" \\
     efi.client_id="SEU_CLIENT_ID" \\
     efi.client_secret="SEU_CLIENT_SECRET" \\
     efi.pix_key="SUA_CHAVE_PIX" \\
     efi.cert_base64="BASE64_CERT" \\
     efi.cert_passphrase="SENHA_SE_HOUVER"
   ```
4. Publique as funções:
   ```
   firebase deploy --only functions
   ```
5. Use a URL publicada no front-end:
   ```
   window.EFI_BACKEND_URL = 'https://us-central1-SEU-PROJETO.cloudfunctions.net/efiApi';
   ```

## Pix
- Cria cobrança em `/v2/cob`.
- Gera QR Code em `/v2/loc/{id}/qrcode`.

## Cartão (checkout transparente)
Para cartão é necessário **tokenizar** o cartão com a biblioteca da Efí.
O backend espera `cartao.token` no payload. Ajuste a tokenização no front-end conforme a documentação da Efí e preencha o campo oculto `card_token`.
Você pode expor uma função global `window.EFI_TOKENIZE_CARD` para gerar o token e preencher o formulário.

## Webhook
Configure o webhook da Efí para apontar para:
```
https://seu-backend.com/api/efi/webhook
```

Atualize o status do pedido no Firestore dentro de `handleWebhookNotification`.
