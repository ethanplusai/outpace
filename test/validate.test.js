'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../server/validate');

function chaseBody(overrides) {
  return Object.assign(
    {
      mode: 'chase', variant: 'endless', name: 'Ada', handleType: 'none', handle: '',
      score: 1000, wpm: 60, accuracy: 98.4, level: 3, durationMs: 60000, chars: 300, errors: 5,
    },
    overrides
  );
}

test('isValidBoard accepts only the four boards', () => {
  assert.ok(v.isValidBoard('chase', 'endless'));
  assert.ok(v.isValidBoard('sprint', '60'));
  assert.ok(!v.isValidBoard('sprint', '45'));
  assert.ok(!v.isValidBoard('chase', '15'));
  assert.ok(!v.isValidBoard(undefined, undefined));
});

test('cleanName strips control/zero-width chars and collapses whitespace', () => {
  assert.equal(v.cleanName('  A\u200Bd\u0007a   Lo\tve  '), 'Ada Lo ve');
  assert.equal(v.cleanName(42), '');
});

test('normalizeHandle validates github and x handles', () => {
  assert.equal(v.normalizeHandle('github', '@octo-cat').handle, 'octo-cat');
  assert.ok(!v.normalizeHandle('github', 'bad--name').ok);
  assert.ok(!v.normalizeHandle('github', '-bad').ok);
  assert.equal(v.normalizeHandle('x', '@jack_1').handle, 'jack_1');
  assert.ok(!v.normalizeHandle('x', 'way_too_long_handle_x').ok);
  assert.equal(v.normalizeHandle('none', 'ignored').handle, '');
  assert.ok(!v.normalizeHandle('mastodon', 'x').ok);
});

test('normalizeName falls back to handle and enforces limits', () => {
  assert.equal(v.normalizeName('', 'octocat').name, 'octocat');
  assert.equal(v.normalizeName('', '').error, 'Name is required');
  assert.ok(!v.normalizeName('x'.repeat(21), '').ok);
  assert.ok(v.normalizeName('x'.repeat(20), '').ok);
});

test('validateScoreFields accepts a good chase run and rounds stats', () => {
  const r = v.validateScoreFields(chaseBody({ wpm: 60.04, accuracy: 98.36 }));
  assert.ok(r.ok);
  assert.equal(r.value.wpm, 60);
  assert.equal(r.value.accuracy, 98.4);
});

test('validateScoreFields rejects out-of-range and non-finite numbers', () => {
  assert.ok(!v.validateScoreFields(chaseBody({ score: -1 })).ok);
  assert.ok(!v.validateScoreFields(chaseBody({ score: 1.5 })).ok);
  assert.ok(!v.validateScoreFields(chaseBody({ wpm: NaN })).ok);
  assert.ok(!v.validateScoreFields(chaseBody({ level: 0 })).ok);
  assert.ok(!v.validateScoreFields(chaseBody({ durationMs: 500 })).ok);
  assert.ok(!v.validateScoreFields(chaseBody({ chars: '300' })).ok);
});

test('validateScoreFields checks wpm and accuracy consistency', () => {
  assert.equal(v.validateScoreFields(chaseBody({ wpm: 90 })).error, 'Stats are inconsistent');
  assert.equal(v.validateScoreFields(chaseBody({ accuracy: 90 })).error, 'Stats are inconsistent');
});

test('validateScoreFields enforces sprint and chase rules', () => {
  const sprint = { mode: 'sprint', variant: '15', durationMs: 15000, chars: 75, errors: 0, accuracy: 100, wpm: 60, score: 60, level: 1 };
  assert.ok(v.validateScoreFields(chaseBody(sprint)).ok);
  assert.ok(!v.validateScoreFields(chaseBody(Object.assign({}, sprint, { durationMs: 20000, chars: 100 }))).ok);
  assert.ok(!v.validateScoreFields(chaseBody(Object.assign({}, sprint, { score: 61 }))).ok);
  assert.ok(!v.validateScoreFields(chaseBody(Object.assign({}, sprint, { level: 2 }))).ok);
  assert.ok(!v.validateScoreFields(chaseBody({ score: 300 * 150 + 1 })).ok);
});

test('parsePaging clamps limit and offset', () => {
  assert.deepEqual(v.parsePaging(undefined, undefined), { limit: 50, offset: 0 });
  assert.deepEqual(v.parsePaging('500', '-4'), { limit: 100, offset: 0 });
  assert.deepEqual(v.parsePaging('0', '7'), { limit: 1, offset: 7 });
});

test('level must fit the run length and wpm is capped', () => {
  const base = { mode: 'chase', variant: 'endless', name: 'a', handleType: 'none', handle: '', score: 100, wpm: 60, accuracy: 100, level: 5, durationMs: 60000, chars: 300, errors: 0 };
  assert.ok(v.validateScoreFields(base).ok);
  assert.ok(!v.validateScoreFields({ ...base, level: 6 }).ok);
  assert.ok(!v.validateScoreFields({ ...base, wpm: 230, chars: 1150 }).ok);
});
