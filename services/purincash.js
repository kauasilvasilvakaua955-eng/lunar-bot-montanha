const axios = require('axios');

const BASE_URL = 'https://api.purincash.com/v1';
const GATEWAY_KEY = 'ps_live_cd567d751a8565129a1d6637222cab306d4906fc9c50b60d19351f54ca240cd6';
const WEBHOOK_SECRET = '7a77f8439df67cf940ca2e34dd17591ea248a76d149c1a44ef67b79b5de3a135';

async function createPixCharge(value, description) {
  try {
    const valueCents = Math.round(value * 100);
    const response = await axios.post(`${BASE_URL}/charges`, {
      valueCents: valueCents,
      description: description
    }, {
      headers: {
        'Authorization': `Bearer ${GATEWAY_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message || 'Falha ao gerar o PIX.');
  }
}

async function getWalletBalance() {
  try {
    const response = await axios.get(`${BASE_URL}/wallet/balance`, {
      headers: { 'Authorization': `Bearer ${GATEWAY_KEY}` }
    });
    return response.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
}

async function withdrawAll(pixKey) {
  try {
    const response = await axios.post(`${BASE_URL}/wallet/withdraw`, { pixKey }, {
      headers: { 'Authorization': `Bearer ${GATEWAY_KEY}` }
    });
    return response.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
}

async function payPixWithMargin(pixKey, amount) {
  try {
    const valueCents = Math.round(amount * 100);
    const response = await axios.post(`${BASE_URL}/pix/pay`, { pixKey, valueCents }, {
      headers: { 'Authorization': `Bearer ${GATEWAY_KEY}` }
    });
    return response.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
}

function monitorPayment(chargeId, onSuccess, onExpire) {
  let attempts = 0;
  const maxAttempts = 60;
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(interval);
      if (onExpire) onExpire();
      return;
    }
    try {
      const response = await axios.get(`${BASE_URL}/charges/${chargeId}`, {
        headers: { 'Authorization': `Bearer ${GATEWAY_KEY}` }
      });
      const status = response.data.status || response.data.state;
      if (status === 'PAID' || status === 'completed' || status === 'approved') {
        clearInterval(interval);
        if (onSuccess) onSuccess(response.data);
      }
    } catch (e) {}
  }, 10000);
}

module.exports = {
  createPixCharge,
  getWalletBalance,
  withdrawAll,
  payPixWithMargin,
  monitorPayment
};
