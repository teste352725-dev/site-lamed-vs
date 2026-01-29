const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const {
  createPixCharge,
  createCardCharge,
  handleWebhookNotification
} = require('./efiClient');

admin.initializeApp();

const efiConfig = functions.config().efi || {};
process.env.EFI_BASE_URL = process.env.EFI_BASE_URL || efiConfig.base_url;
process.env.EFI_CLIENT_ID = process.env.EFI_CLIENT_ID || efiConfig.client_id;
process.env.EFI_CLIENT_SECRET = process.env.EFI_CLIENT_SECRET || efiConfig.client_secret;
process.env.EFI_PIX_KEY = process.env.EFI_PIX_KEY || efiConfig.pix_key;
process.env.EFI_CERT_BASE64 = process.env.EFI_CERT_BASE64 || efiConfig.cert_base64;
process.env.EFI_CERT_PATH = process.env.EFI_CERT_PATH || efiConfig.cert_path;
process.env.EFI_CERT_PASSPHRASE = process.env.EFI_CERT_PASSPHRASE || efiConfig.cert_passphrase;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/pix', async (req, res) => {
  try {
    const response = await createPixCharge(req.body);
    res.json(response);
  } catch (error) {
    console.error('Erro PIX Efí:', error);
    res.status(500).json({ message: error.message || 'Erro ao criar cobrança PIX' });
  }
});

app.post('/cartao', async (req, res) => {
  try {
    const response = await createCardCharge(req.body);
    res.json(response);
  } catch (error) {
    console.error('Erro cartão Efí:', error);
    res.status(500).json({ message: error.message || 'Erro ao criar cobrança no cartão' });
  }
});

app.post('/webhook', async (req, res) => {
  try {
    await handleWebhookNotification(req.body);
    res.json({ received: true });
  } catch (error) {
    console.error('Erro webhook Efí:', error);
    res.status(500).json({ message: error.message || 'Erro ao processar webhook' });
  }
});

exports.efiApi = functions.region('us-central1').https.onRequest(app);
