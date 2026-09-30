'use strict';
// JSON-file score store: loaded once into memory, debounced atomic writes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD_CAP = 5000;
const WRITE_DEBOUNCE_MS = 250;

function resolveSecret(dataDir, override) {
  if (override) return override;
  if (process.env.OUTPACE_SECRET) return process.env.OUTPACE_SECRET;
  const file = path.join(dataDir, 'secret.txt');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (_) {
    // fall through and generate one
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

function identityOf(entry) {
  return entry.handle
    ? `${entry.handleType}:${entry.handle.toLowerCase()}`
    : `name:${entry.name.normalize('NFKC').toLowerCase().replace(/[\s@._\-!?.,]+$/u, '')}`;
}

// Higher score, then higher accuracy, then earlier createdAt.
function compareEntries(a, b) {
  return b.score - a.score || b.accuracy - a.accuracy || a.createdAt.localeCompare(b.createdAt);
}

function createStore({ dataDir, secret, now = Date.now } = {}) {
  dataDir = dataDir || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const file = path.join(dataDir, 'scores.json');
  const tmp = path.join(dataDir, 'scores.json.tmp');
  let data = { boards: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.boards === 'object') data = parsed;
  } catch (_) {
    // missing or corrupt file: start empty
  }

  let timer = null;
  let dirty = false;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
      dirty = false;
    } catch (err) {
      console.error('Failed to write scores:', err.message);
    }
  }

  function scheduleWrite() {
    dirty = true;
    if (!timer) timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
  }

  function getBoard(key) {
    return data.boards[key] || [];
  }

  // Adds a run, keeping only each player's best. Returns { improved, entry, rank, total }.
  function addScore(key, fields) {
    const board = data.boards[key] || (data.boards[key] = []);
    const candidate = {
      id: crypto.randomBytes(6).toString('hex'),
      name: fields.name,
      handleType: fields.handleType,
      handle: fields.handle,
      score: fields.score,
      wpm: fields.wpm,
      accuracy: fields.accuracy,
      level: fields.level,
      durationMs: fields.durationMs,
      device: fields.device,
      browser: fields.browser,
      os: fields.os,
      createdAt: new Date(now()).toISOString(),
    };
    const identity = identityOf(candidate);
    const idx = board.findIndex((e) => identityOf(e) === identity);

    let improved = true;
    let entry = candidate;
    if (idx !== -1) {
      if (candidate.score <= board[idx].score) {
        improved = false;
        entry = board[idx];
      } else {
        board.splice(idx, 1);
      }
    }

    if (improved) {
      board.push(candidate);
      board.sort(compareEntries);
      if (board.length > BOARD_CAP) board.length = BOARD_CAP;
      scheduleWrite();
    }

    const pos = board.indexOf(entry);
    return { improved, entry, rank: pos === -1 ? null : pos + 1, total: board.length };
  }

  // Sliding-window rate limiting and single-use run ids live in memory; fine for one process.
  const hits = new Map();
  const runs = new Map();

  function hit(kind, ip, windowMs) {
    const t = now();
    const key = kind + ':' + ip;
    const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10000) {
      for (const [k, list] of hits) if (!list.some((ts) => t - ts < windowMs)) hits.delete(k);
    }
    return recent.length;
  }

  function claimRun(runId, ttlMs) {
    const t = now();
    for (const [id, exp] of runs) if (exp <= t) runs.delete(id);
    if (runs.has(runId)) return false;
    runs.set(runId, t + ttlMs);
    return true;
  }

  function page(key, offset, limit) {
    const board = getBoard(key);
    return { entries: board.slice(offset, offset + limit), total: board.length };
  }

  return { secret: resolveSecret(dataDir, secret), getBoard, addScore, hit, claimRun, page, flush };
}

module.exports = { createStore, identityOf, compareEntries, BOARD_CAP };
