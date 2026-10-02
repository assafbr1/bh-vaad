// Build the encrypted data for the Beit Horon committee viewer site.
// Usage: node build.mjs bundle.json outDir
// bundle.json: { generatedAt, logUrl, tasks:[...], meetings:[...], members:[{id,name,role,code,active,perms,phone,email,lastLoginAt}], topics:{...}, agenda:{next,free} }
// perms: { report: 'all' | 'own', agenda: 'direct' } lets a member send progress reports from the site, and (agenda) put items on the next meeting's agenda without Assaf's approval (see index.html).
// phone (digits with country code, e.g. 972501234567) and email feed the reminder buttons (wa.me / mailto) on the site.
// lastLoginAt (version 1.7): the member's latest login as recorded by the runs from the login log; the site uses it as the
// "since my previous visit" baseline for the "what's new" marking, so the marking is the same on phone and desktop.
// agenda (version 1.7): meta/agenda from the editing board; only approved free items are published, and a task's
// agenda mark is published only when approved (proposals wait for Assaf and never reach the site).
// Output: outDir/data.enc.txt, outDir/keys.json and outDir/parts/data.enc.part-NN.txt (30,000-char slices of data.enc.txt)
// Each run draws a fresh random data key. Every active member's code wraps that key,
// so a code removed from the list stops working on the next build.
import { webcrypto as crypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ITER = 300000;
const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normPhone = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '972' + d.slice(1); return d; };

async function lookupId(code) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode('bhv1:' + normCode(code)));
  return Buffer.from(h).toString('hex').slice(0, 24);
}
async function kek(code, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}

const [, , bundlePath, outDir = '.'] = process.argv;
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const members = (bundle.members || []).filter((m) => m.active !== false && normCode(m.code).length >= 10);
if (!members.length) { console.error('No active members with codes'); process.exit(1); }

// a task's agenda mark reaches the site only once approved
const publishTask = (t) => { if (t.agenda && t.agenda.status !== 'approved') { const c = Object.assign({}, t); delete c.agenda; return c; } return t; };
const agenda = bundle.agenda || {};

const payload = {
  v: 1,
  generatedAt: bundle.generatedAt || new Date().toISOString(),
  logUrl: bundle.logUrl || '',
  tasks: (bundle.tasks || []).filter((t) => t.approved !== false).map(publishTask),
  meetings: bundle.meetings || [],
  topics: bundle.topics || {},   // { '<super-topic>': { goal, lead } } from meta/topics
  agenda: { next: agenda.next || {}, free: (agenda.free || []).filter((x) => x.status === 'approved'), lastAttached: agenda.lastAttached || null },
  // people: contact details for reminders are included only for active members
  people: (bundle.members || []).map((m) => ({ id: m.id, name: m.name, role: m.role || '', perms: (m.active !== false && m.perms) || null,
    phone: (m.active !== false && normPhone(m.phone)) || '', email: (m.active !== false && String(m.email || '').trim()) || '',
    lastLoginAt: m.lastLoginAt || '' })),
};

const rawKey = crypto.getRandomValues(new Uint8Array(32));
const dataKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, gzipSync(enc.encode(JSON.stringify(payload)))));
const blob = new Uint8Array(iv.length + ct.length); blob.set(iv); blob.set(ct, iv.length);

const entries = {};
for (const m of members) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wiv = crypto.getRandomValues(new Uint8Array(12));
  const k = await kek(m.code, salt);
  const inner = enc.encode(JSON.stringify({ k: b64(rawKey), id: m.id, n: m.name }));
  const wct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wiv }, k, inner));
  entries[await lookupId(m.code)] = { s: b64(salt), i: b64(wiv), c: b64(wct) };
}

mkdirSync(outDir, { recursive: true });
const dataText = b64(blob);
writeFileSync(outDir + '/data.enc.txt', dataText);
writeFileSync(outDir + '/keys.json', JSON.stringify({ v: 1, iter: ITER, builtAt: payload.generatedAt, entries }));
// Parts for the scheduled runs: data.enc.txt is too large to pass through one GitHub push_files call,
// so the run pushes data.enc.part-NN.txt (each <= PART_SIZE chars) to a build-* branch and the
// publish-build workflow concatenates them back into data.enc.txt on main. Concatenation is byte-exact.
const PART_SIZE = 30000;
const parts = [];
for (let i = 0; i * PART_SIZE < dataText.length; i++) parts.push(dataText.slice(i * PART_SIZE, (i + 1) * PART_SIZE));
mkdirSync(outDir + '/parts', { recursive: true });
parts.forEach((t, i) => writeFileSync(`${outDir}/parts/data.enc.part-${String(i + 1).padStart(2, '0')}.txt`, t));
console.log(`OK: ${payload.tasks.length} tasks, ${payload.meetings.length} meetings, ${members.length} member keys, ${dataText.length} bytes, ${parts.length} parts in ${outDir}/parts`);
