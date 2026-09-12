import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeServerFnBody, decodeSeroval, decodeServerFnResponse, escapeSerovalString, unescapeSerovalString } from '../src/serverfn.js';

test('a flat argument encodes the way the official site sends it', () => {
  assert.deepEqual(encodeServerFnBody({ assessmentId: 'q-1' }), {
    t: { t: 10, i: 0, p: { k: ['data'], v: [{ t: 10, i: 1, p: { k: ['assessmentId'], v: [{ t: 1, s: 'q-1' }] }, o: 0 }] }, o: 0 },
    f: 127,
    m: [],
  });
});

test('nested arrays and objects are numbered in the order they are written', () => {
  const body = encodeServerFnBody({ answers: [{ questionId: 'a', response: { choice: 1 } }] });
  const data = body.t.p.v[0];
  const answers = data.p.v[0];
  const first = answers.a[0];
  const response = first.p.v[1];
  assert.deepEqual([data.i, answers.i, first.i, response.i], [1, 2, 3, 4]);
  assert.deepEqual(response.p.v[0], { t: 0, s: 1 });
});

test('null and booleans encode as seroval constants', () => {
  assert.deepEqual(encodeServerFnBody({ a: null, b: true, c: false }).t.p.v[0].p.v, [{ t: 2, s: 0 }, { t: 2, s: 2 }, { t: 2, s: 3 }]);
});

test('strings round-trip through seroval escaping', () => {
  const text = 'He said "hi" <b> \\n\nnext line';
  assert.equal(unescapeSerovalString(escapeSerovalString(text)), text);
  assert.equal(escapeSerovalString('<'), '\\x3C');
});

test('a quiz response decodes into plain values', () => {
  const body = {
    t: 10, i: 0, o: 0,
    p: {
      k: ['result', 'error', 'context'],
      v: [
        {
          t: 10, i: 1, o: 0,
          p: {
            k: ['assessment', 'questions'],
            v: [
              { t: 10, i: 2, o: 0, p: { k: ['title', 'time_limit_minutes', 'published'], v: [{ t: 1, s: 'Read \\"Harrison\\"\\nthen answer' }, { t: 2, s: 0 }, { t: 2, s: 2 }] } },
              {
                t: 9, i: 3, o: 0,
                a: [{ t: 10, i: 4, o: 0, p: { k: ['id', 'position', 'options', 'points'], v: [{ t: 1, s: 'q1' }, { t: 0, s: 0 }, { t: 9, i: 5, o: 0, a: [{ t: 1, s: 'yes' }, { t: 1, s: 'no' }] }, { t: 0, s: 1 }] } }],
              },
            ],
          },
        },
        { t: 2, s: 1 },
        { t: 11, i: 6, o: 0, p: { k: [], v: [] } },
      ],
    },
  };
  const { result, error } = decodeServerFnResponse(body);
  assert.equal(error, undefined);
  assert.deepEqual(result.assessment, { title: 'Read "Harrison"\nthen answer', time_limit_minutes: null, published: true });
  assert.deepEqual(result.questions, [{ id: 'q1', position: 0, options: ['yes', 'no'], points: 1 }]);
});

test('a reference node resolves to the node it points back at', () => {
  const decoded = decodeSeroval({ t: 9, i: 0, o: 0, a: [{ t: 10, i: 1, o: 0, p: { k: ['x'], v: [{ t: 0, s: 1 }] } }, { t: 4, i: 1 }] });
  assert.equal(decoded[0], decoded[1]);
});

test('a key named __proto__ stays plain data', () => {
  const decoded = decodeSeroval({ t: 10, i: 0, o: 0, p: { k: ['__proto__'], v: [{ t: 1, s: 'x' }] } });
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(decoded, '__proto__').value, 'x');
});

test('unknown node types throw instead of guessing', () => {
  assert.throws(() => decodeSeroval({ t: 99 }), /unsupported seroval node type 99/);
});
