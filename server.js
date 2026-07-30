const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const MarketEngine = require('./marketEngine');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Main User App Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin Panel Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const market = new MarketEngine(1.08500, 0.00018);

setInterval(() => {
  io.emit('price_tick', { timestamp: Date.now(), price: market.generateNextTick() });
}, 100);

// Auth Endpoints
app.post('/api/auth/register', (req, res) => {
  const { email, password, phone } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });
  const result = market.registerUser(email, password, phone);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const result = market.loginUser(email, password);
  res.json(result);
});

// KYC Endpoint
app.post('/api/kyc/submit', (req, res) => {
  const { userId, name, nidNumber } = req.body;
  const data = market.submitKYC(userId, name, nidNumber);
  res.json({ success: true, message: 'KYC Submitted for Approval', data });
});

// Wallet Endpoints
app.post('/api/deposit', (req, res) => {
  const { userId, amount, method, trxId } = req.body;
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt < 5) return res.status(400).json({ success: false, message: 'Minimum deposit is $5' });
  const data = market.requestDeposit(userId || 'USER_101', numAmt, method, trxId);
  res.json({ success: true, message: 'Deposit submitted for approval', data });
});

app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, accountNo } = req.body;
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt < 10) return res.status(400).json({ success: false, message: 'Minimum withdrawal is $10' });
  const data = market.requestWithdrawal(userId || 'USER_101', numAmt, method, accountNo);
  res.json({ success: true, message: 'Withdrawal submitted for approval', data });
});

// Admin Endpoints
app.get('/api/admin/data', (req, res) => {
  res.json({
    stats: market.getStats(),
    pendingDeposits: market.pendingDeposits,
    pendingWithdrawals: market.pendingWithdrawals,
    pendingKYCs: market.pendingKYCs
  });
});

app.post('/api/admin/action', (req, res) => {
  const { id, type, action } = req.body;
  if (action === 'APPROVE') {
    const item = market.approveTransaction(id, type);
    res.json({ success: true, item });
  } else {
    market.rejectTransaction(id, type);
    res.json({ success: true });
  }
});

io.on('connection', (socket) => {
  socket.on('place_trade', (data) => {
    const entryPrice = market.currentPrice;
    const durationSec = parseInt(data.durationSec) || 60;
    const expiresAt = Date.now() + (durationSec * 1000);

    const trade = {
      id: 'TRD_' + Date.now(),
      userId: data.userId || 'USER_101',
      type: data.type,
      entryPrice,
      amount: parseFloat(data.amount) || 10,
      expiresAt
    };

    market.addTrade(trade);

    setTimeout(() => {
      const finalPrice = market.currentPrice;
      let isWin = false;
      if (data.type === 'CALL' && finalPrice > entryPrice) isWin = true;
      if (data.type === 'PUT' && finalPrice < entryPrice) isWin = true;

      socket.emit('trade_result', {
        tradeId: trade.id,
        isWin,
        entryPrice,
        closePrice: finalPrice,
        payout: isWin ? (parseFloat(data.amount) * 1.85) : 0
      });
    }, durationSec * 1000);
  });

  socket.on('admin_set_user_mode', (data) => {
    market.setUserMode(data.userId, data.mode);
    socket.emit('admin_status', { success: true, userId: data.userId, mode: data.mode });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Engine running on port ${PORT}`));
