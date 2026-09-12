// Meraki's own app (meraki-education.app) is a TanStack Start site, and a few
// things it does never go through Supabase's REST API: they're server
// functions, POSTed to /_serverFn/<id>. Arguments and results travel as
// seroval's JSON node tree rather than plain JSON, so this module speaks just
// enough of that format (the node types seen in captured traffic) to send a
// plain argument object and read the result back.
//
//   { t: 0, s: 12 }                  number
//   { t: 1, s: 'escaped text' }      string (seroval-escaped, see below)
//   { t: 2, s: 0 }                   constant: null, undefined, true, false, …
//   { t: 4, i: 3 }                   reference to an earlier array/object
//   { t: 9, i: 3, a: [...] }         array
//   { t: 10, i: 3, p: { k, v } }     object (t: 11 for a null-prototype one)
//
// `i` numbers arrays and objects in the order they're first written.

const CONSTANTS = [null, undefined, true, false, -0, Infinity, -Infinity, NaN];

// seroval escapes these inside string values and object keys, on top of the
// JSON escaping the whole body gets.
const ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\b': '\\b', '\t': '\\t', '\f': '\\f', '<': '\\x3C', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const UNESCAPES = { n: '\n', r: '\r', b: '\b', t: '\t', f: '\f' };

export function escapeSerovalString(str) {
  return str.replace(/["\\\n\r\b\t\f<\u2028\u2029]/g, (ch) => ESCAPES[ch]);
}

export function unescapeSerovalString(str) {
  return str.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, esc) => {
    if (esc.length > 1) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return UNESCAPES[esc] ?? esc;
  });
}

/** The request body for calling a server function with `data` as its argument. */
export function encodeServerFnBody(data) {
  let nextId = 0;
  const write = (value) => {
    if (value === null) return { t: 2, s: 0 };
    if (value === undefined) return { t: 2, s: 1 };
    if (typeof value === 'boolean') return { t: 2, s: value ? 2 : 3 };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`can't send ${value} to a server function`);
      return { t: 0, s: value };
    }
    if (typeof value === 'string') return { t: 1, s: escapeSerovalString(value) };
    if (Array.isArray(value)) {
      const i = nextId++;
      return { t: 9, i, a: value.map((item) => write(item)), o: 0 };
    }
    if (typeof value === 'object') {
      const i = nextId++;
      const keys = Object.keys(value);
      return { t: 10, i, p: { k: keys.map(escapeSerovalString), v: keys.map((k) => write(value[k])) }, o: 0 };
    }
    throw new Error(`can't send a ${typeof value} to a server function`);
  };
  return { t: write({ data }), f: 127, m: [] };
}

/** Reads a seroval node tree back into plain values. Throws on a node type
 * this module doesn't know rather than guessing at it. */
export function decodeSeroval(node) {
  const refs = new Map();
  const read = (n) => {
    if (n == null) return undefined; // an array hole
    switch (n.t) {
      case 0:
        return n.s;
      case 1:
        return unescapeSerovalString(n.s);
      case 2:
        if (!(n.s in CONSTANTS)) throw new Error(`unknown seroval constant ${n.s}`);
        return CONSTANTS[n.s];
      case 4:
        if (!refs.has(n.i)) throw new Error(`seroval reference to unknown node ${n.i}`);
        return refs.get(n.i);
      case 9: {
        const arr = [];
        refs.set(n.i, arr);
        for (const item of n.a) arr.push(read(item));
        return arr;
      }
      case 10:
      case 11: {
        const obj = {};
        refs.set(n.i, obj);
        // defineProperty, not assignment: a key named __proto__ must stay data.
        n.p.k.forEach((key, j) => {
          Object.defineProperty(obj, unescapeSerovalString(key), { value: read(n.p.v[j]), enumerable: true, writable: true, configurable: true });
        });
        return obj;
      }
      default:
        throw new Error(`unsupported seroval node type ${n.t}`);
    }
  };
  return read(node);
}

/** A server function's response body, as { result, error }. */
export function decodeServerFnResponse(body) {
  const decoded = decodeSeroval(body);
  if (!decoded || typeof decoded !== 'object') throw new Error('unexpected server function response');
  return { result: decoded.result, error: decoded.error };
}
