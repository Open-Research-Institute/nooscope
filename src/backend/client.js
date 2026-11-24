// Talks to a "bring your own backend" Worker (see worker/src/index.js).
// The viewer stays static: the backend URL comes from ?backend=, and the write
// key is pasted by the user and kept only in this browser's localStorage.

const KEY_STORAGE_PREFIX = 'nooscope:backend-key:';

export function createBackend(rawUrl) {
    const base = rawUrl.replace(/\/+$/, '');

    async function request(path, init) {
        let response;
        try {
            response = await fetch(`${base}${path}`, init);
        } catch (err) {
            throw new Error(`Could not reach the backend at ${base} (${err.message}).`);
        }
        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try { message = (await response.json()).error || message; } catch { /* not JSON */ }
            throw new Error(message);
        }
        return response.json();
    }

    return {
        url: base,

        list() {
            return request('/datasets');
        },

        load(name) {
            return request(`/datasets/${encodeURIComponent(name)}`);
        },

        save(name, data, { key, title }) {
            const body = JSON.stringify(data);
            return request(`/datasets/${encodeURIComponent(name)}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'X-Nooscope-Title': encodeURIComponent(title || name),
                    'X-Nooscope-Points': String(data.points?.length ?? ''),
                },
                body,
            });
        },

        getSavedKey() {
            try { return localStorage.getItem(KEY_STORAGE_PREFIX + base) || ''; } catch { return ''; }
        },

        setSavedKey(key) {
            try { localStorage.setItem(KEY_STORAGE_PREFIX + base, key); } catch { /* storage blocked */ }
        },
    };
}

// Lowercase, dashes for anything else, trimmed to the Worker's name rule.
export function toDatasetName(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[-_]+|-+$/g, '')
        .slice(0, 64);
}
