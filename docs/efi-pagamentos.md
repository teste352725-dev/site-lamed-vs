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
