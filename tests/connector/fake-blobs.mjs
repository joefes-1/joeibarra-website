// In-memory stand-in for @netlify/blobs used by tests/connector/run.mjs
const stores = globalThis.__stores ||= {}
export const getStore = ({ name }) => { const m = stores[name] ||= new Map(); return {
  list: async (o = {}) => ({ blobs: [...m.keys()].filter(k => k.startsWith(o.prefix || '')).map(key => ({ key })) }),
  get: async (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
  setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); return {} },
  delete: async (k) => { m.delete(k) } } }
