'use strict';
/**
 * sunscrap — rate limiter
 * Throttling keselamatan best-effort, sinkron (dijalankan di proses utama).
 * Port dari engine extension chrome-extension/utils/rate-limiter.js, dengan
 * persistensi ke objek storage eksternal (berkas) agar tidak bergantung chrome.*.
 *
 * Layer:
 *  1 Session break (istirahat 3–5 menit tiap 30–50 task)
 *  2 Visit budget per siklus (500) + rail harian (2000)
 *  3 Auto speed selection
 *  4 Random dwell time (1–4 dtk)
 *  5 Warm-up (5 task pertama lebih lambat)
 *  6 Fatigue (makin lama makin lambat)
 */

function createRateLimiter(storage) {
  const R = {
    MODES: {
      safe: { min: 5000, max: 10000, label: 'Aman (5-10 dtk)' },
      normal: { min: 3000, max: 8000, label: 'Normal (3-8 dtk)' },
      aggressive: { min: 1500, max: 3000, label: 'Cepat (1,5-3 dtk)' },
    },

    currentMode: 'normal',
    backoffMultiplier: 1,
    consecutiveErrors: 0,

    sessionTaskCount: 0,
    sessionBreakThreshold: 30 + Math.floor(Math.random() * 21),

    SESSION_BREAK_MIN: 180000,
    SESSION_BREAK_MAX: 300000,
    MAX_DELAY_MS: 60000,
    VISIT_BUDGET: 500,
    DAILY_VISIT_RAIL: 2000,

    cycleId: null,
    cycleVisits: 0,
    dailyVisits: 0,
    lastResetDate: new Date().toDateString(),
    totalTasksThisSession: 0,

    persistSession() {
      storage.set({
        sa_sessionTaskCount: this.sessionTaskCount,
        sa_sessionBreakThreshold: this.sessionBreakThreshold,
        sa_totalTasksThisSession: this.totalTasksThisSession,
        sa_consecutiveErrors: this.consecutiveErrors,
        sa_backoffMultiplier: this.backoffMultiplier,
      });
    },

    persistDaily() {
      storage.set({
        sa_dailyTaskCount: this.dailyVisits,
        sa_lastResetDate: this.lastResetDate,
        sa_cycleId: this.cycleId,
        sa_cycleVisits: this.cycleVisits,
      });
    },

    init() {
      const data = storage.get([
        'sa_dailyTaskCount', 'sa_lastResetDate', 'sa_cycleId', 'sa_cycleVisits',
        'sa_sessionTaskCount', 'sa_sessionBreakThreshold', 'sa_totalTasksThisSession',
        'sa_consecutiveErrors', 'sa_backoffMultiplier',
      ]);
      const today = new Date().toDateString();
      const sameDay = data.sa_lastResetDate === today;

      if (sameDay) {
        this.dailyVisits = Number(data.sa_dailyTaskCount) || 0;
        this.lastResetDate = today;
        this.cycleId = data.sa_cycleId || null;
        this.cycleVisits = Number(data.sa_cycleVisits) || 0;
        this.sessionTaskCount = Number.isFinite(Number(data.sa_sessionTaskCount)) ? Number(data.sa_sessionTaskCount) : 0;
        this.totalTasksThisSession = Number.isFinite(Number(data.sa_totalTasksThisSession)) ? Number(data.sa_totalTasksThisSession) : 0;
      } else {
        this.startSession();
        this.dailyVisits = 0;
        this.cycleVisits = 0;
        this.cycleId = null;
        this.persistDaily();
      }

      const threshold = Number(data.sa_sessionBreakThreshold);
      if (Number.isFinite(threshold) && threshold >= 10 && threshold <= 100) this.sessionBreakThreshold = threshold;
      const errors = Number(data.sa_consecutiveErrors);
      if (Number.isFinite(errors) && errors >= 0) this.consecutiveErrors = errors;
      const backoff = Number(data.sa_backoffMultiplier);
      if (Number.isFinite(backoff) && backoff >= 1 && backoff <= 10) this.backoffMultiplier = backoff;
      return this;
    },

    startSession() {
      this.totalTasksThisSession = 0;
      this.sessionTaskCount = 0;
      this.sessionBreakThreshold = 30 + Math.floor(Math.random() * 21);
      this.consecutiveErrors = 0;
      this.backoffMultiplier = 1;
      this.lastResetDate = new Date().toDateString();
      this.persistSession();
    },

    rollDayIfNeeded() {
      const today = new Date().toDateString();
      if (today === this.lastResetDate) return;
      this.dailyVisits = 0;
      this.cycleVisits = 0;
      this.cycleId = null;
      this.startSession();
      this.persistDaily();
    },

    beginCycle(cycleId) {
      const next = cycleId === null || cycleId === undefined ? null : String(cycleId);
      if (next === this.cycleId) return false;
      this.cycleId = next;
      this.cycleVisits = 0;
      this.persistDaily();
      return true;
    },

    hasVisitBudget() {
      this.rollDayIfNeeded();
      return this.cycleVisits < this.VISIT_BUDGET && this.dailyVisits < this.DAILY_VISIT_RAIL;
    },

    recordVisit() {
      this.rollDayIfNeeded();
      this.cycleVisits++;
      this.dailyVisits++;
      this.persistDaily();
    },

    getVisitsRemaining() {
      return Math.max(0, Math.min(
        this.VISIT_BUDGET - this.cycleVisits,
        this.DAILY_VISIT_RAIL - this.dailyVisits,
      ));
    },

    needsSessionBreak() {
      return this.sessionTaskCount >= this.sessionBreakThreshold;
    },

    getSessionBreakDuration() {
      return this.SESSION_BREAK_MIN + Math.floor(Math.random() * (this.SESSION_BREAK_MAX - this.SESSION_BREAK_MIN));
    },

    resetSessionBreak() {
      this.sessionTaskCount = 0;
      this.sessionBreakThreshold = 30 + Math.floor(Math.random() * 21);
      this.persistSession();
    },

    /** Reset seluruh hitungan throttle (dipakai saat "Hapus semua data"). */
    resetCounters() {
      this.cycleVisits = 0;
      this.dailyVisits = 0;
      this.cycleId = null;
      this.sessionTaskCount = 0;
      this.totalTasksThisSession = 0;
      this.consecutiveErrors = 0;
      this.backoffMultiplier = 1;
      this.sessionBreakThreshold = 30 + Math.floor(Math.random() * 21);
      this.persistDaily();
      this.persistSession();
    },

    recordTaskCompleted() {
      this.sessionTaskCount++;
    },

    autoSelectMode(pendingCount) {
      if (pendingCount <= 50) this.setMode('aggressive');
      else if (pendingCount <= 300) this.setMode('normal');
      else this.setMode('safe');
    },

    setMode(mode) {
      if (this.MODES[mode]) this.currentMode = mode;
    },

    getDwellTime() {
      return 1000 + Math.floor(Math.random() * 3000);
    },

    isWarmingUp() {
      return this.totalTasksThisSession < 5;
    },

    getWarmupMultiplier() {
      if (this.totalTasksThisSession === 0) return 3.0;
      if (this.totalTasksThisSession === 1) return 2.5;
      if (this.totalTasksThisSession === 2) return 2.0;
      if (this.totalTasksThisSession === 3) return 1.5;
      if (this.totalTasksThisSession === 4) return 1.2;
      return 1.0;
    },

    getFatigueMultiplier() {
      const level = Math.floor(this.sessionTaskCount / 10);
      return 1.0 + Math.min(0.5, level * 0.1);
    },

    getDelay() {
      const { min, max } = this.MODES[this.currentMode];
      const u1 = Math.random();
      const u2 = Math.random();
      const gaussian = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
      const mean = (min + max) / 2;
      const std = (max - min) / 6;
      let delay = mean + gaussian * std;
      if (!Number.isFinite(delay)) delay = mean;
      delay = Math.max(min, Math.min(max, delay));
      delay *= this.getWarmupMultiplier();
      delay *= this.getFatigueMultiplier();
      delay *= this.backoffMultiplier;
      return Math.min(this.MAX_DELAY_MS, Math.round(delay));
    },

    reportSuccess() {
      this.consecutiveErrors = 0;
      this.backoffMultiplier = 1;
      this.totalTasksThisSession++;
      this.recordTaskCompleted();
      this.recordVisit();
      this.persistSession();
    },

    reportError() {
      this.consecutiveErrors++;
      this.backoffMultiplier = Math.min(10, Math.pow(1.5, this.consecutiveErrors));
      this.totalTasksThisSession++;
      this.recordTaskCompleted();
      this.recordVisit();
      this.persistSession();
    },

    recordAuxiliaryVisit() {
      this.sessionTaskCount++;
      this.recordVisit();
      this.persistSession();
    },

    getPaceLabel() {
      const { min, max } = this.MODES[this.currentMode];
      const factor = Math.min(
        this.MAX_DELAY_MS / max,
        this.getWarmupMultiplier() * this.getFatigueMultiplier() * this.backoffMultiplier,
      );
      return `${Math.round((min * factor) / 1000)}-${Math.round((max * factor) / 1000)} dtk`;
    },

    getStatus() {
      return {
        mode: this.currentMode,
        modeLabel: this.MODES[this.currentMode] ? this.MODES[this.currentMode].label : this.currentMode,
        paceLabel: this.getPaceLabel(),
        sessionTasks: this.sessionTaskCount,
        sessionBreakAt: this.sessionBreakThreshold,
        cycleId: this.cycleId,
        cycleVisits: this.cycleVisits,
        visitBudget: this.VISIT_BUDGET,
        cycleRemaining: Math.max(0, this.VISIT_BUDGET - this.cycleVisits),
        dailyVisits: this.dailyVisits,
        dailyRail: this.DAILY_VISIT_RAIL,
        remaining: this.getVisitsRemaining(),
        isWarmup: this.isWarmingUp(),
        fatigue: this.getFatigueMultiplier(),
        backoff: this.backoffMultiplier,
      };
    },

    estimateTime(remainingCount) {
      const { min, max } = this.MODES[this.currentMode];
      const multiplied = ((min + max) / 2)
        * this.getWarmupMultiplier() * this.getFatigueMultiplier() * this.backoffMultiplier;
      const avgDelay = Math.min(this.MAX_DELAY_MS, multiplied);
      const avgPerItem = avgDelay + 4000;
      const breaksNeeded = Math.floor(remainingCount / this.sessionBreakThreshold);
      const breakTime = breaksNeeded * ((this.SESSION_BREAK_MIN + this.SESSION_BREAK_MAX) / 2);
      const totalMs = (remainingCount * avgPerItem) + breakTime;
      return {
        totalMs,
        minutes: Math.ceil(totalMs / 60000),
        display: this.formatTime(totalMs),
        breaksEstimated: breaksNeeded,
      };
    },

    formatTime(ms) {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      return hours > 0 ? `${hours}j ${minutes}m` : `${minutes}m`;
    },
  };

  return R;
}

module.exports = { createRateLimiter };