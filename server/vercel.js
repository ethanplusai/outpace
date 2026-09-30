'use strict';
// Vercel function adapter: same API as the local server, backed by Upstash Redis.

const { createApi, parseBody, MAX_BODY } = require('./api');
const { createRedisStore } = require('./redis-store');

let api = null;
const getApi = () => api || (api = createApi({ store: createRedisStore() }));

function readBody(req) {
  if (req.method !== 'POST') return { ok: true, value: {} };
  if (Number(req.headers['content-length']) > MAX_BODY) return { ok: false, status: 413, error: 'Request body too large' };
  let b;
  try {
    b = req.body; // Vercel parses lazily and throws on malformed JSON
  } catch (_) {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return parseBody(JSON.stringify(b));
  return parseBody(Buffer.isBuffer(b) ? b.toString('utf8') : b);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://outpace.local');
  const ip = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const out = await getApi().handle({ method: req.method, pathname: url.pathname, query: url.searchParams, body: readBody(req), ip });
  res.statusCode = out.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, val] of Object.entries(out.headers)) res.setHeader(k, val);
  res.end(JSON.stringify(out.body));
};
