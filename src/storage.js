// In production (deployed to Vercel) data goes to Neon via /api routes.
// In local dev (`npm run dev`) data stays in localStorage unless VITE_USE_API=true.
const USE_API = import.meta.env.PROD || import.meta.env.VITE_USE_API === 'true';

// ——— in-memory cache: list() populates it so get() needs no extra round-trips ———
const cache = new Map();

// ——— localStorage fallback (used during local dev) ———
const ls = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value !== null ? { value } : null;
  },
  async set(key, value) { localStorage.setItem(key, value); },
  async delete(key) { localStorage.removeItem(key); },
  async list(prefix) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return { keys };
  },
};

// ——— API adapter (used in production) ———
const api = {
  async get(key) {
    // Collections are pre-populated by list(); settings are fetched on demand.
    if (cache.has(key)) return { value: cache.get(key) };
    const res = await fetch('/api/settings?key=' + encodeURIComponent(key));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.value == null) return null;
    cache.set(key, data.value);
    return { value: data.value };
  },

  async set(key, value) {
    cache.set(key, value);
    if (key.startsWith('piece:')) {
      await fetch('/api/pieces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: value, // already a JSON string
      });
    } else if (key.startsWith('inspo:')) {
      await fetch('/api/inspo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: value,
      });
    } else if (key.startsWith('fit:')) {
      await fetch('/api/fits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: value,
      });
    } else if (key.startsWith('want:')) {
      await fetch('/api/wants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: value,
      });
    } else {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    }
  },

  async delete(key) {
    cache.delete(key);
    if (key.startsWith('piece:')) {
      await fetch('/api/pieces/' + encodeURIComponent(key.slice(6)), { method: 'DELETE' });
    } else if (key.startsWith('inspo:')) {
      await fetch('/api/inspo/' + encodeURIComponent(key.slice(6)), { method: 'DELETE' });
    } else if (key.startsWith('fit:')) {
      await fetch('/api/fits/' + encodeURIComponent(key.slice(6)), { method: 'DELETE' });    } else if (key.startsWith('want:')) {
      await fetch('/api/wants/' + encodeURIComponent(key.slice(5)), { method: 'DELETE' });    }
  },

  async list(prefix) {
    const map = { 'piece:': '/api/pieces', 'inspo:': '/api/inspo', 'fit:': '/api/fits', 'want:': '/api/wants' };
    const endpoint = map[prefix];
    if (!endpoint) return { keys: [] };
    const res = await fetch(endpoint);
    const items = await res.json();
    const keys = [];
    for (const item of items) {
      const key = prefix + item.id;
      cache.set(key, JSON.stringify(item));
      keys.push(key);
    }
    return { keys };
  },
};

const storage = USE_API ? api : ls;
export default storage;
