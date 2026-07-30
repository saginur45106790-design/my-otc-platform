const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const MarketEngine = require('./marketEngine');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files directly from root directory
app.use(express.static(__dirname));

// Route root URL to index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const market = new MarketEngine(1.08500, 0.00018);

// Broadcast ticks 10 times per second for smooth chart rendering
setInterval(() => {
  const price = market.generateNextTick();
  io.emit('price_tick', {
    timestamp: Date.now(),
    price: price
  });
}, 100);

// Deposit API ($5 Minimum Validation)
app.post('/api/deposit', (req, res) => {
  const { userId, amount, method, trxId } = req.body;
  const numericAmount = parseFloat(amount);
  
  if (isNaN(numericAmount) || numericAmount < 5) {
    return res.status(400).json({ success: false, message: 'Minimum deposit amount is $5' });
  }

  const reqObj = market.requestDeposit(userId || 'USER_101', numericAmount, method || 'bKash', trxId || 'N/A');
  res.json({ success: true, message: 'Deposit request submitted for Admin Approval', data: reqObj });
});

// Withdrawal API ($10 Minimum Validation)
app.post('/api/withdraw', (req, res) => {
  const { userId, amount, method, accountNo } = req.body;
  const numericAmount = parseFloat(amount);
  
  if (isNaN(numericAmount) || numericAmount < 10) {
    return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $10' });
  }

  const reqObj = market.requestWithdrawal(userId || 'USER_101', numericAmount, method || 'bKash', accountNo || 'N/A');
  res.json({ success: true, message: 'Withdrawal request submitted for Admin Approval', data: reqObj });
});

// Admin Stats & Queue API
app.get('/api/admin/data', (req, res) => {
  res.json({
    stats: market.getStats(),
    pendingDeposits: market.pendingDeposits,
    pendingWithdrawals: market.pendingWithdrawals
  });
});

// Admin Approve/Reject API
app.post('/api/admin/action', (req, res) => {
  const { id, type, action } = req.body; // action: 'APPROVE' | 'REJECT'
  
  if (action === 'APPROVE') {
    const item = market.approveTransaction(id, type);
    res.json({ success: true, message: 'Transaction Approved', item });
  } else {
    market.rejectTransaction(id, type);
    res.json({ success: true, message: 'Transaction Rejected' });
  }
});

// Socket Connections
io.on('connection', (socket) => {
  socket.on('place_trade', (data) => {
    const entryPrice = market.currentPrice;
    const durationSec = parseInt(data.durationSec) || 60;
    const expiresAt = Date.now() + (durationSec * 1000);

    const trade = {
      id: 'TRD_' + Date.now(),
      userId: data.userId || 'USER_101',
      type: data.type,
      entryPrice: entryPrice,
      amount: parseFloat(data.amount) || 10,
      expiresAt: expiresAt
    };

    market.addTrade(trade);

    setTimeout(() => {
      const finalPrice = market.currentPrice;
      let isWin = false;

      if (data.type === 'CALL' && finalPrice > entryPrice) isWin = true;
      if (data.type === 'PUT' && finalPrice < entryPrice) isWin = true;

      socket.emit('trade_result', {
        tradeId: trade.id,
        isWin: isWin,
        entryPrice: entryPrice,
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
server.listen(PORT, () => {
  console.log(`PRO-TRADE International Engine running on port ${PORT}`);
});
