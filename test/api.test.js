import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyLoadError, login } from '../src/api.js';

test('an expired/failed refresh maps to a re-login message', () => {
  const msg = friendlyLoadError('grades', new Error('token refresh failed (400): {}'));
  assert.match(msg, /log in again/i);
});

test('a browser network failure maps to a connectivity message', () => {
  const msg = friendlyLoadError('grades', new Error('Failed to fetch'));
  assert.match(msg, /couldn't reach meraki/i);
  assert.match(msg, /grades/);
});

test('anything else maps to a generic retry message naming the label', () => {
  const msg = friendlyLoadError('your portfolio', new Error('GET portfolio_items failed (500): oops'));
  assert.match(msg, /couldn't load your portfolio/i);
});

test('login assumes @meraki.local when the input has no domain', async (t) => {
  let sentBody;
  const realFetch = global.fetch;
  global.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', user: { id: 'u1' } }) };
  };
  t.after(() => {
    global.fetch = realFetch;
  });

  await login('jstudent', 'hunter2');
  assert.equal(sentBody.email, 'jstudent@meraki.local');
});

test('login leaves a full email address untouched', async (t) => {
  let sentBody;
  const realFetch = global.fetch;
  global.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', user: { id: 'u1' } }) };
  };
  t.after(() => {
    global.fetch = realFetch;
  });

  await login('teacher@otherdomain.org', 'hunter2');
  assert.equal(sentBody.email, 'teacher@otherdomain.org');
});
