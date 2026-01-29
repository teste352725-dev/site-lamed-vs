import fs from 'fs';
import { Agent } from 'undici';

const {
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERT_PATH,
  EFI_CERT_BASE64,
  EFI_CERT_PASSPHRASE,
  EFI_BASE_URL,
  EFI_PIX_KEY
} = process.env;

if (!EFI_BASE_URL) {
  console.warn('EFI_BASE_URL não definido. Configure no .env');
}

function loadCertificate() {
  if (EFI_CERT_BASE64) {
    return Buffer.from(EFI_CERT_BASE64, 'base64');
  }
  if (EFI_CERT_PATH) {
    return fs.readFileSync(EFI_CERT_PATH);
  }
  throw new Error('Certificado Efí não configurado (EFI_CERT_BASE64 ou EFI_CERT_PATH).');
}

function buildDispatcher() {
  const cert = loadCertificate();
  const isPfx = Boolean(EFI_CERT_PATH && /\.(p12|pfx)$/i.test(EFI_CERT_PATH));
  const connectOptions = {
    rejectUnauthorized: true
  };

  if (isPfx) {
    connectOptions.pfx = cert;
  } else {
    connectOptions.cert = cert;
    connectOptions.key = cert;
  }

  if (EFI_CERT_PASSPHRASE) {
    connectOptions.passphrase = EFI_CERT_PASSPHRASE;
  }

  return new Agent({ connect: connectOptions });
}

async function getAccessToken() {
  if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET) {
    throw new Error('EFI_CLIENT_ID/EFI_CLIENT_SECRET não configurados.');
  }
  const auth = Buffer.from(`${EFI_CLIENT_ID}:${EFI_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${EFI_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
    dispatcher: buildDispatcher()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao obter token Efí: ${errorText}`);
  }
  const data = await response.json();
  return data.access_token;
}

async function efiRequest(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${EFI_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    dispatcher: buildDispatcher()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro Efí (${path}): ${errorText}`);
  }

  return response.json();
}

export async function createPixCharge(payload) {
  if (!EFI_PIX_KEY) {
    throw new Error('EFI_PIX_KEY não configurada.');
  }

  const devedorCpf = payload?.cliente?.cpf || payload?.cliente?.cpfCnpj || payload?.cliente?.cpf_cnpj;
  if (!devedorCpf) {
    throw new Error('CPF do cliente é obrigatório para cobrança Pix.');
  }

  const body = {
    calendario: { expiracao: 3600 },
    devedor: {
      cpf: devedorCpf.replace(/\D/g, ''),
      nome: payload?.cliente?.nome
    },
    valor: {
      original: Number(payload.total).toFixed(2)
    },
    chave: EFI_PIX_KEY,
    solicitacaoPagador: `Pedido ${payload.pedidoId}`
  };

  const cobrança = await efiRequest('/v2/cob', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  const qrCode = await efiRequest(`/v2/loc/${cobrança.loc.id}/qrcode`, {
    method: 'GET'
  });

  return {
    status: cobrança.status,
    chargeId: cobrança.txid,
    pixId: cobrança.loc.id,
    qrCodeImage: qrCode.imagemQrcode,
    pixCopiaCola: qrCode.qrcode,
    message: 'Cobrança Pix criada. Use o QR Code para pagar.'
  };
}

export async function createCardCharge(payload) {
  if (!payload?.cartao?.token) {
    throw new Error('Token do cartão não informado. Configure a tokenização Efí.');
  }
  if (!payload?.cliente?.cpf) {
    throw new Error('CPF do cliente é obrigatório para cobrança no cartão.');
  }

  const body = {
    items: payload.itens.map(item => ({
      name: item.nome,
      value: Math.round(item.preco * 100),
      amount: item.quantidade
    })),
    payment: {
      credit_card: {
        installments: Number(payload.parcelas || 1),
        payment_token: payload.cartao.token,
        customer: {
          name: payload.cliente.nome,
          cpf: payload.cliente.cpf.replace(/\D/g, ''),
          email: payload.cliente.email,
          phone_number: payload.cliente.telefone?.replace(/\D/g, '') || ''
        },
        billing_address: {
          street: payload.cliente.endereco.rua,
          number: payload.cliente.endereco.numero,
          neighborhood: payload.cliente.endereco.bairro || 'Centro',
          zipcode: payload.cliente.endereco.cep.replace(/\D/g, ''),
          city: payload.cliente.endereco.cidade,
          state: payload.cliente.endereco.uf || 'ES'
        }
      }
    }
  };

  const cobrança = await efiRequest('/v1/charge', {
    method: 'POST',
    body: JSON.stringify({ items: body.items })
  });

  const pagamento = await efiRequest(`/v1/charge/${cobrança.data.charge_id}/pay`, {
    method: 'POST',
    body: JSON.stringify({ payment: body.payment })
  });

  return {
    status: pagamento.code === 200 ? 'paid' : 'pending',
    chargeId: cobrança.data.charge_id,
    message: 'Pagamento com cartão enviado para processamento.',
    data: pagamento
  };
}

export async function handleWebhookNotification(payload) {
  return payload;
}
