'use strict';
// Pure validation helpers for the Outpace API. No I/O, no clocks.

const BOARDS = ['chase:endless', 'sprint:15', 'sprint:30', 'sprint:60'];

const GITHUB_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const X_RE = /^[A-Za-z0-9_]{1,15}$/;
const HANDLE_TYPES = ['github', 'x', 'none'];

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE_RE = /[\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

function boardKey(mode, variant) {
  return `${mode}:${variant}`;
}

function isValidBoard(mode, variant) {
  return typeof mode === 'string' && typeof variant === 'string' && BOARDS.includes(boardKey(mode, variant));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function inRange(v, min, max, integer) {
  return isNum(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
}

function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(CONTROL_RE, '')
    .replace(INVISIBLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns { ok, handleType, handle } or { ok:false, error }.
function normalizeHandle(handleType, rawHandle) {
  if (!HANDLE_TYPES.includes(handleType)) {
    return { ok: false, error: 'handleType must be "github", "x" or "none"' };
  }
  if (handleType === 'none') return { ok: true, handleType, handle: '' };

  const handle = (typeof rawHandle === 'string' ? rawHandle.trim() : '').replace(/^@/, '');
  if (handleType === 'github' && !GITHUB_RE.test(handle)) {
    return { ok: false, error: 'Invalid GitHub username' };
  }
  if (handleType === 'x' && !X_RE.test(handle)) {
    return { ok: false, error: 'Invalid X handle' };
  }
  return { ok: true, handleType, handle };
}

// Name rules; falls back to the handle when the name is empty.
function normalizeName(rawName, handle) {
  let name = cleanName(rawName);
  if (name.length > 20) return { ok: false, error: 'Name must be 20 characters or fewer' };
  if (!name && handle) name = handle;
  if (!name) return { ok: false, error: 'Name is required' };
  return { ok: true, name };
}

// Validates everything about a score body that does not depend on the token,
// clock or stored state. Returns { ok:true, value } or { ok:false, error }.
function validateScoreFields(body) {
  const b = body || {};

  const h = normalizeHandle(b.handleType, b.handle);
  if (!h.ok) return h;
  const n = normalizeName(b.name, h.handle);
  if (!n.ok) return n;

  const { score, wpm, accuracy, level, durationMs, chars, errors } = b;
  if (!inRange(score, 0, 10000000, true)) return fail('score must be an integer between 0 and 10,000,000');
  if (!inRange(wpm, 0, 220)) return fail('wpm must be a number between 0 and 220');
  if (!inRange(accuracy, 0, 100)) return fail('accuracy must be a number between 0 and 100');
  if (!inRange(level, 1, 99, true)) return fail('level must be an integer between 1 and 99');
  if (!inRange(durationMs, 1000, 3600000)) return fail('durationMs must be between 1,000 and 3,600,000');
  if (!inRange(chars, 0, 100000, true)) return fail('chars must be an integer between 0 and 100,000');
  if (!inRange(errors, 0, 100000, true)) return fail('errors must be an integer between 0 and 100,000');

  const expectedWpm = chars / 5 / (durationMs / 60000);
  if (Math.abs(wpm - expectedWpm) > Math.max(3, expectedWpm * 0.15)) return fail('Stats are inconsistent');

  if (chars + errors > 0) {
    const expectedAcc = (chars / (chars + errors)) * 100;
    if (Math.abs(accuracy - expectedAcc) > 2) return fail('Stats are inconsistent');
  }

  if (b.mode === 'sprint') {
    if (Math.abs(durationMs - Number(b.variant) * 1000) > 1500) return fail('Sprint duration does not match the selected mode');
    if (score !== Math.round(wpm)) return fail('Sprint score must equal WPM');
    if (level !== 1) return fail('Sprint level must be 1');
  } else if (b.mode === 'chase') {
    if (score > chars * 150) return fail('Score is not plausible for the characters typed');
    // waves are time-based (one per 20 s), so the level can't outrun the clock
    if (level > 2 + Math.floor(durationMs / 20000)) return fail('Level is not plausible for the run length');
  }

  return {
    ok: true,
    value: {
      name: n.name,
      handleType: h.handleType,
      handle: h.handle,
      score,
      wpm: round1(wpm),
      accuracy: round1(accuracy),
      level,
      durationMs,
      chars,
      errors,
    },
  };
}

function fail(error) {
  return { ok: false, error };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Parses leaderboard paging params with clamping.
function parsePaging(limitRaw, offsetRaw) {
  let limit = parseInt(limitRaw, 10);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.min(100, Math.max(1, limit));
  let offset = parseInt(offsetRaw, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

module.exports = {
  BOARDS,
  boardKey,
  isValidBoard,
  cleanName,
  normalizeHandle,
  normalizeName,
  validateScoreFields,
  parsePaging,
  round1,
};
