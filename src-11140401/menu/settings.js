// menu/settings.js (progress lane, Nov 14): the player's settings, kept in localStorage 'crosstown.settings' as one JSON object.
// Settings only (Matt, Nov 14: no saving of progress). Every storage access is in try/catch: with storage blocked the settings
// simply live for the session. game.settings.get(key, dflt) / .set(key, value) / .on(key, fn) / .def(key, dflt) / .reset().
const KEY = 'crosstown.settings';
export class Settings {
  constructor() {
    this.v = {}; this.d = {}; this.l = new Map(); this.stored = false;
    try { const s = localStorage.getItem(KEY); this.stored = true; if (s) { const o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) this.v = o; } } catch (e) {}
  }
  // the default for a key, used by get() when nothing is stored and no default is passed, and by reset()
  def(key, dflt) { if (!(key in this.d)) this.d[key] = dflt; return this; }
  get(key, dflt) { return Object.prototype.hasOwnProperty.call(this.v, key) ? this.v[key] : dflt !== undefined ? dflt : this.d[key]; }
  set(key, value) {
    if (value === undefined) { if (!(key in this.v)) return; delete this.v[key]; }
    else { if (typeof value !== 'object' && this.v[key] === value) return; this.v[key] = value; }
    this.save(); this.fire(key);
  }
  on(key, fn) { let a = this.l.get(key); if (!a) this.l.set(key, (a = [])); a.push(fn); return () => { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  fire(key) { const v = this.get(key); for (const k of [key, '*']) for (const fn of (this.l.get(k) || []).slice()) { try { fn(v, key); } catch (e) { try { console.log('[settings] listener for ' + key + ': ' + (e && e.message)); } catch (e2) {} } } }
  save() { try { if (Object.keys(this.v).length) localStorage.setItem(KEY, JSON.stringify(this.v)); else localStorage.removeItem(KEY); this.stored = true; } catch (e) { this.stored = false; } }
  reset() { const keys = Object.keys(this.v); this.v = {}; this.save(); for (const k of keys) this.fire(k); }
}
