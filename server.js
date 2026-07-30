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

// Serve main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const market = new MarketEngine(1.08500, 0.00015);

// Broadcast price ticks 10 times per second for smooth chart movement
setInterval(() => {
  const price = market.generateNextTick();
  io.emit('price_tick', {
    timestamp: Date.now(),
    price: price
  });
}, 100);

// Deposit API ($5 Minimum Rule)
app.post('/api/deposit', (req, res) => {
  const { amount } = req.body;
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 5) {
    return res.status(400).json({ success: false, message: 'Minimum deposit amount is $5' });
  }
  market.addDeposit(numericAmount);
  res.json({ success: true, message: 'Deposit recorded successfully' });
});

// Withdrawal API ($10 Minimum Rule)
app.post('/api/withdraw', (req, res) => {
  const { amount } = req.body;
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 10) {
    return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $10' });
  }
  market.addWithdrawal(numericAmount);
  res.json({ success: true, message: 'Withdrawal request submitted' });
});

// Get Admin Financial Stats API
app.get('/api/admin/stats', (req, res) => {
  res.json(market.getStats());
});

// WebSocket Real-time Handlers
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

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
  console.log(`PRO-TRADE OTC Engine running on port ${PORT}`);
});