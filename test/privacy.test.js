import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacyParagraphs, DATA_AND_PRIVACY } from '../src/privacy.js';

test('parses into a nonempty list of paragraphs', () => {
  const paras = privacyParagraphs();
  assert.ok(paras.length > 5);
});

test('the READS ONLY table becomes label/desc rows', () => {
  const paras = privacyParagraphs();
  const readsPara = paras.find((p) => p.lines[0].text?.includes('READS ONLY'));
  assert.ok(readsPara);
  const overviewRow = readsPara.lines.find((l) => l.label === 'Overview');
  assert.ok(overviewRow);
  assert.match(overviewRow.desc, /assignments/);
});

test('mentions the self-hosted trust model', () => {
  assert.match(DATA_AND_PRIVACY, /it never\s+sees your password/);
});

test('lists every table this client writes to', () => {
  for (const table of ['messages', 'checkins', 'portfolio_items', 'login_events', 'assignment_submissions', 'file_uploads']) {
    assert.match(DATA_AND_PRIVACY, new RegExp(table));
  }
});
