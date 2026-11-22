// localStorage persistence; every storage access is guarded (private mode / quota / corrupt data).
const MAX_AGE_MS = 30 * 60 * 1000;

export function createSaver(key, getPayload) {
  let due = 0;
  const saver = {
    soon() { due = performance.now() + 400; },
    tick() { if (due && performance.now() >= due) saver.now(); },
    now() {
      due = 0;
      try {
        const payload = getPayload();
        if (payload) localStorage.setItem(key, JSON.stringify(payload));
      } catch (e) { /* ignore */ }
    },
    clear() { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
    // returns { state, stageIndex } or null
    load(def, stages) {
      let data = null;
      try { const s = localStorage.getItem(key); data = s ? JSON.parse(s) : null; } catch (e) { return null; }
      try {
        if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object' || Array.isArray(data.state)) return null;
        if (!def || data.state.v !== def.v) return null;
        const age = Date.now() - data.t;
        if (!Number.isFinite(age) || age > MAX_AGE_MS || age < -60000) return null;
        const idx = stages.findIndex((s) => s && s.id === data.stage);
        if (idx < 0) return null;
        return { state: Object.assign(def, data.state), stageIndex: idx };
      } catch (e) { return null; }
    },
  };
  return saver;
}
