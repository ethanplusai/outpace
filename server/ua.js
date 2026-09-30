'use strict';
// Coarse device/browser/OS labels from a User-Agent string. Only these labels are stored, never the raw UA.

const BROWSERS = [
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/OPR\/|OPiOS\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

const OSES = [
  [/iPhone|iPod/, 'iOS'],
  [/iPad/, 'iPadOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

function match(list, ua) {
  for (const [re, name] of list) if (re.test(ua)) return name;
  return 'Other';
}

// touch: the client's hint that it has a touchscreen, used only to spot iPads, which report as a Mac.
function parseUserAgent(ua, touch) {
  ua = typeof ua === 'string' ? ua.slice(0, 512) : '';
  let os = match(OSES, ua);
  let device = 'desktop';
  if (os === 'iOS' || (os === 'Android' && /Mobile/.test(ua)) || /Mobi/.test(ua)) device = 'mobile';
  else if (os === 'iPadOS' || os === 'Android') device = 'tablet';
  if (os === 'macOS' && touch === true) {
    os = 'iPadOS';
    device = 'tablet';
  }
  return { device, browser: match(BROWSERS, ua), os };
}

module.exports = { parseUserAgent };
