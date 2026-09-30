'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUserAgent } = require('../server/ua');

const UA = {
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

test('parses common desktop, phone and tablet user agents', () => {
  assert.deepEqual(parseUserAgent(UA.macChrome), { device: 'desktop', browser: 'Chrome', os: 'macOS' });
  assert.deepEqual(parseUserAgent(UA.macSafari), { device: 'desktop', browser: 'Safari', os: 'macOS' });
  assert.deepEqual(parseUserAgent(UA.winEdge), { device: 'desktop', browser: 'Edge', os: 'Windows' });
  assert.deepEqual(parseUserAgent(UA.winFirefox), { device: 'desktop', browser: 'Firefox', os: 'Windows' });
  assert.deepEqual(parseUserAgent(UA.iphoneSafari), { device: 'mobile', browser: 'Safari', os: 'iOS' });
  assert.deepEqual(parseUserAgent(UA.iphoneChrome), { device: 'mobile', browser: 'Chrome', os: 'iOS' });
  assert.deepEqual(parseUserAgent(UA.androidPhone), { device: 'mobile', browser: 'Chrome', os: 'Android' });
  assert.deepEqual(parseUserAgent(UA.androidTablet), { device: 'tablet', browser: 'Chrome', os: 'Android' });
  assert.deepEqual(parseUserAgent(UA.samsung), { device: 'mobile', browser: 'Samsung Internet', os: 'Android' });
  assert.deepEqual(parseUserAgent(UA.linuxFirefox), { device: 'desktop', browser: 'Firefox', os: 'Linux' });
  assert.deepEqual(parseUserAgent(UA.chromebook), { device: 'desktop', browser: 'Chrome', os: 'ChromeOS' });
});

test('an iPad posing as a Mac is caught by the touch hint', () => {
  assert.deepEqual(parseUserAgent(UA.macSafari, true), { device: 'tablet', browser: 'Safari', os: 'iPadOS' });
});

test('missing or junk user agents fall back safely', () => {
  assert.deepEqual(parseUserAgent(undefined), { device: 'desktop', browser: 'Other', os: 'Other' });
  assert.deepEqual(parseUserAgent('<script>alert(1)</script>'), { device: 'desktop', browser: 'Other', os: 'Other' });
});
