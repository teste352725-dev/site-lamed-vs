import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  createPixCharge,
  createCardCharge,
  handleWebhookNotification
} from './services/efiService.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/efi/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/efi/pix', async (req, res) => {
  try {
    const response = await createPixCharge(req.body);
    res.json(response);
  } catch (error) {
    console.error('Erro PIX Efí:', error);
    res.status(500).json({ message: error.message || 'Erro ao criar cobrança PIX' });
  }
});

app.post('/api/efi/cartao', async (req, res) => {
  try {
    const response = await createCardCharge(req.body);
    res.json(response);
  } catch (error) {
    console.error('Erro cartão Efí:', error);
    res.status(500).json({ message: error.message || 'Erro ao criar cobrança no cartão' });
  }
});

app.post('/api/efi/webhook', async (req, res) => {
  try {
    await handleWebhookNotification(req.body);
    res.json({ received: true });
  } catch (error) {
    console.error('Erro webhook Efí:', error);
    res.status(500).json({ message: error.message || 'Erro ao processar webhook' });
  }
});

const port = process.env.PORT || 3333;
app.listen(port, () => {
  console.log(`Backend Efí rodando na porta ${port}`);
});
