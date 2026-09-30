'use strict';
// Outpace backend: static files + JSON API, Node built-ins only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createStore } = require('./store');
const { createApi, parseBody, MAX_BODY } = require('./api');

const CSP =
  "default-src 'self'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com https://unavatar.io; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const GZIP_EXT = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt']);

function createServer(options = {}) {
  const now = options.now || Date.now;
  const publicDir = path.resolve(options.publicDir || path.join(__dirname, '..', 'public'));
  const trustProxy = options.trustProxy !== undefined ? !!options.trustProxy : process.env.TRUST_PROXY === '1';
  const store = createStore({ dataDir: options.dataDir || process.env.DATA_DIR, secret: options.secret, now });

  const api = createApi({ store, now });

  function clientIp(req) {
    if (trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      if (fwd) return String(fwd).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function baseHeaders(extra) {
    return Object.assign(
      {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': CSP,
      },
      extra
    );
  }

  function sendJson(res, status, payload, extraHeaders) {
    const body = JSON.stringify(payload);
    res.writeHead(status, baseHeaders(Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    }, extraHeaders)));
    res.end(body);
  }

  function sendText(res, status, text) {
    res.writeHead(status, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) }));
    res.end(text);
  }

  // Reads the body as text, stopping early (and reporting 413) once it passes MAX_BODY.
  function readBody(req) {
    return new Promise((resolve) => {
      if (req.method !== 'POST') return resolve({ ok: true, value: {} });
      if (Number(req.headers['content-length']) > MAX_BODY) {
        req.resume();
        return resolve({ ok: false, status: 413, error: 'Request body too large', close: true });
      }
      const chunks = [];
      let size = 0;
      let done = false;
      req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > MAX_BODY) {
          done = true;
          req.resume();
          return resolve({ ok: false, status: 413, error: 'Request body too large', close: true });
        }
        chunks.push(chunk);
      });
      req.on('end', () => { if (!done) resolve(parseBody(Buffer.concat(chunks).toString('utf8'))); });
      req.on('error', () => { if (!done) resolve({ ok: false, status: 400, error: 'Invalid JSON body' }); });
    });
  }

  async function handleApi(req, res, url) {
    const body = await readBody(req);
    const out = await api.handle({ method: req.method, pathname: url.pathname, query: url.searchParams, body, ip: clientIp(req), ua: req.headers['user-agent'] });
    sendJson(res, out.status, out.body, Object.assign(body.close ? { Connection: 'close' } : {}, out.headers));
  }

  // ---- static files ----

  function handleStatic(req, res, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method not allowed');
    }

    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch (_) {
      return sendText(res, 400, 'Bad request');
    }
    if (decoded.includes('\0')) return sendText(res, 400, 'Bad request');

    let filePath = path.resolve(publicDir, '.' + decoded);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) return sendText(res, 403, 'Forbidden');

    let stat = statOrNull(filePath);
    if (stat && stat.isDirectory()) stat = null;
    if (!stat) {
      // Extension-less unknown paths fall back to the SPA shell.
      if (path.extname(decoded)) return sendText(res, 404, 'Not found');
      filePath = path.join(publicDir, 'index.html');
      stat = statOrNull(filePath);
      if (!stat) return sendText(res, 404, 'Not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = baseHeaders({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Revalidate every time; the ETag makes unchanged files a cheap 304.
      'Cache-Control': 'no-cache',
    });
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    headers.ETag = etag;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    let body;
    try {
      body = fs.readFileSync(filePath);
    } catch (_) {
      return sendText(res, 404, 'Not found');
    }

    if (GZIP_EXT.has(ext)) {
      headers.Vary = 'Accept-Encoding';
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        body = zlib.gzipSync(body);
        headers['Content-Encoding'] = 'gzip';
      }
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  // ---- server ----

  const server = http.createServer((req, res) => {
    const rawPath = (req.url || '/').split('?')[0];
    try {
      if (rawPath === '/api' || rawPath.startsWith('/api/')) {
        const url = new URL(req.url, 'http://localhost');
        handleApi(req, res, url).catch((err) => internalError(res, err));
      } else {
        handleStatic(req, res, rawPath);
      }
    } catch (err) {
      internalError(res, err);
    }
  });

  function internalError(res, err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error' });
    else res.end();
  }

  server.store = store;
  server.flush = store.flush;
  server.on('close', store.flush);
  return server;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch (_) {
    return null;
  }
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  const server = createServer();
  server.listen(port, () => console.log(`Outpace running at http://localhost:${port}`));

  const shutdown = () => {
    server.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
