'use strict';
// Upstash Redis store over the REST API (plain fetch, no SDK). Used on Vercel, where there is no disk.
//
// Per board:  <prefix>b:<board>:z  sorted set  identity -> score * 1e4 + accuracy * 10
//             <prefix>b:<board>:e  hash        identity -> entry JSON
// Runs:       <prefix>run:<runId>              single-use marker with TTL
// Limits:     <prefix>rl:<kind>:<ip>:<bucket>  fixed-window counter with TTL

const crypto = require('crypto');
const { identityOf, BOARD_CAP } = require('./store');

// Keeps only a player's best: replaces the entry only when the new score is strictly higher.
const ADD_SCRIPT = `
local old = redis.call('ZSCORE', KEYS[1], ARGV[1])
local improved = 1
if old and math.floor(tonumber(old) / 10000) >= tonumber(ARGV[4]) then improved = 0 end
if improved == 1 then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  local n = redis.call('ZCARD', KEYS[1])
  local cap = tonumber(ARGV[5])
  if n > cap then
    local drop = redis.call('ZRANGE', KEYS[1], 0, n - cap - 1)
    for _, id in ipairs(drop) do redis.call('HDEL', KEYS[2], id) end
    redis.call('ZREMRANGEBYRANK', KEYS[1], 0, n - cap - 1)
  end
end
local rank = redis.call('ZREVRANK', KEYS[1], ARGV[1])
return { improved, rank or -1, redis.call('ZCARD', KEYS[1]), redis.call('HGET', KEYS[2], ARGV[1]) or '' }
`;

function createRedisStore({
  url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  secret = process.env.OUTPACE_SECRET,
  prefix = process.env.OUTPACE_PREFIX || 'outpace:',
  now = Date.now,
} = {}) {
  if (!url || !token) throw new Error('Outpace: Redis REST url/token missing');

  async function call(path, body) {
    const res = await fetch(url.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error('Redis: ' + (data.error || res.status));
    return data;
  }
  const cmd = async (...args) => (await call('', args)).result;
  const pipeline = async (cmds) => (await call('/pipeline', cmds)).map((r) => {
    if (r.error) throw new Error('Redis: ' + r.error);
    return r.result;
  });

  const zKey = (board) => `${prefix}b:${board}:z`;
  const eKey = (board) => `${prefix}b:${board}:e`;

  async function hit(kind, ip, windowMs) {
    const key = `${prefix}rl:${kind}:${ip}:${Math.floor(now() / windowMs)}`;
    const [count] = await pipeline([['INCR', key], ['PEXPIRE', key, String(windowMs)]]);
    return count;
  }

  async function claimRun(runId, ttlMs) {
    return (await cmd('SET', `${prefix}run:${runId}`, '1', 'NX', 'PX', String(ttlMs))) === 'OK';
  }

  async function addScore(board, fields) {
    const entry = {
      id: crypto.randomBytes(6).toString('hex'),
      name: fields.name,
      handleType: fields.handleType,
      handle: fields.handle,
      score: fields.score,
      wpm: fields.wpm,
      accuracy: fields.accuracy,
      level: fields.level,
      durationMs: fields.durationMs,
      createdAt: new Date(now()).toISOString(),
    };
    const sortScore = entry.score * 10000 + Math.round(entry.accuracy * 10);
    const [improved, rank, total, stored] = await cmd(
      'EVAL', ADD_SCRIPT, '2', zKey(board), eKey(board),
      identityOf(entry), String(sortScore), JSON.stringify(entry), String(entry.score), String(BOARD_CAP)
    );
    return { improved: improved === 1, entry: stored ? JSON.parse(stored) : entry, rank: rank >= 0 ? rank + 1 : null, total };
  }

  async function page(board, offset, limit) {
    const [ids, total] = await pipeline([
      ['ZREVRANGE', zKey(board), String(offset), String(offset + limit - 1)],
      ['ZCARD', zKey(board)],
    ]);
    if (!ids.length) return { entries: [], total };
    const raw = await cmd('HMGET', eKey(board), ...ids);
    return { entries: raw.filter(Boolean).map((r) => JSON.parse(r)), total };
  }

  return { secret, hit, claimRun, addScore, page, flush() {} };
}

module.exports = { createRedisStore };
