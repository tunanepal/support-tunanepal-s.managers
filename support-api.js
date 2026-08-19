/* Tunanepal support desk — Supabase client and session.
   Agents are checked inside Postgres. An agent token unlocks conversations
   and tickets, and nothing that moves money. */

export const SUPABASE_URL = 'https://dzxtwtcizoogqqacnpdd.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_WVMexNwIj4J3bNZwbrEZPg_HBqmX013';
export const BUCKET_PROOF = 'tuna-proof';

const TOKEN_KEY = 'tuna.support';
const NAME_KEY  = 'tuna.support.name';

export const getToken   = () => localStorage.getItem(TOKEN_KEY);
export const setToken   = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(NAME_KEY); };
export const getAgent   = () => { try { return JSON.parse(localStorage.getItem(NAME_KEY) || 'null'); } catch { return null; } };
export const setAgent   = (a) => localStorage.setItem(NAME_KEY, JSON.stringify(a));

function readError(body, status) {
  const raw = body?.message || body?.error_description || body?.error;
  if (!raw) return status === 0 ? 'No connection.' : 'Request failed.';
  return String(raw).replace(/^ERROR:\s*/i, '');
}

export async function rpc(fn, args = {}) {
  let res, body;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args)
    });
  } catch { throw new Error('No connection. Check your internet.'); }
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = new Error(readError(body, res.status));
    err.expired = /session expired/i.test(err.message);
    throw err;
  }
  return body;
}

export const rpcAuth = (fn, args = {}) => rpc(fn, { p_token: getToken(), ...args });

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function upload(file) {
  const ext = EXT[file.type];
  if (!ext) throw new Error('Use a JPG, PNG or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Keep it under 10 MB.');
  const path = `${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET_PROOF}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type,
      'x-upsert': 'false'
    },
    body: file
  });
  if (!res.ok) throw new Error('Upload failed.');
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_PROOF}/${path}`;
}
