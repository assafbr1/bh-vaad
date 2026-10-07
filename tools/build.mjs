// Build the encrypted data for the Beit Horon committee viewer site.
// Usage: node build.mjs bundle.json outDir
// bundle.json: { generatedAt, logUrl, waGroupUrl, tasks:[...], meetings:[...], members:[{id,name,role,code,active,perms,phone,email,lastLoginAt}], topics:{...}, agenda:{planned,next,free},
//                participants:[{id,name,role,org,code,active,phone,email,lastLoginAt}] }
// perms: { report: 'all' | 'own', agenda: 'direct' } lets a member send progress reports from the site, and (agenda) put items on the next meeting's agenda without Assaf's approval (see index.html).
// phone (digits with country code, e.g. 972501234567) and email feed the reminder buttons (wa.me / mailto) on the site.
// lastLoginAt (version 1.7): the member's latest login as recorded by the runs from the login log; the site uses it as the
// "since my previous visit" baseline for the "what's new" marking, so the marking is the same on phone and desktop.
// agenda (version 1.7): meta/agenda from the editing board; only approved free items are published, and a task's
// agenda mark is published only when approved (proposals wait for Assaf and never reach the site).
// participants (version 1.8): external workers, consultants and contractors. They never see the committee site. Each active
// participant with a code gets a separate encrypted file guests/<id>.enc.txt holding only the tasks assigned to him
// (task.participants[] = {id, instruction, assignedAt, due}), reduced to title, status, due, his instruction and the updates marked
// visible to him (update.visibleTo includes '*' or his id); guestkeys.json maps his lookup id to that file. The committee bundle
// gets the participants list without codes (for "the desk of <name>") and the tasks keep their participants field.
// agenda.planned (version 1.10): the planned committee meetings [{id, date, time, place, note}]; agenda items (task.agenda and free[])
// may carry meetingRef (a planned meeting id); without it, or when it points to a meeting no longer planned, the item belongs to the
// nearest planned meeting. next is recomputed here as a copy of the nearest planned meeting, so an older cached site keeps working.
// waGroupUrl (version 1.10): the committee WhatsApp group invite link from meta/site.waGroupUrl. It goes ONLY into the encrypted committee
// bundle (never into index.html, keys.json or the guest bundles), and feeds the "send to the committee group" buttons on the site.
// Output: outDir/data.enc.txt, outDir/keys.json, outDir/parts/data.enc.part-NN.txt (30,000-char slices of data.enc.txt),
//         outDir/guestkeys.json and outDir/guests/<id>.enc.txt (one per active participant; the directory is always written, possibly empty).
// Each run draws a fresh random data key. Every active member's code wraps that key,
// so a code removed from the list stops working on the next build. Guest files use a separate random key each.
import { webcrypto as crypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';

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
// encrypt a JSON payload with a fresh random key; returns { text (base64 iv+ciphertext), rawKey }
async function sealPayload(payload) {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const dataKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, gzipSync(enc.encode(JSON.stringify(payload)))));
  const blob = new Uint8Array(iv.length + ct.length); blob.set(iv); blob.set(ct, iv.length);
  return { text: b64(blob), rawKey };
}
// wrap a raw data key with a person's code; returns the keys.json entry
async function wrapKey(rawKey, person, extra) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wiv = crypto.getRandomValues(new Uint8Array(12));
  const k = await kek(person.code, salt);
  const inner = enc.encode(JSON.stringify({ k: b64(rawKey), id: person.id, n: person.name }));
  const wct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wiv }, k, inner));
  return [await lookupId(person.code), Object.assign({ s: b64(salt), i: b64(wiv), c: b64(wct) }, extra || {})];
}

const [, , bundlePath, outDir = '.'] = process.argv;
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const members = (bundle.members || []).filter((m) => m.active !== false && normCode(m.code).length >= 10);
if (!members.length) { console.error('No active members with codes'); process.exit(1); }
const participants = (bundle.participants || []).filter((p) => p && p.id);
const guests = participants.filter((p) => p.active !== false && normCode(p.code).length >= 10);

// a task's agenda mark reaches the site only once approved
const publishTask = (t) => { if (t.agenda && t.agenda.status !== 'approved') { const c = Object.assign({}, t); delete c.agenda; return c; } return t; };
const agenda = bundle.agenda || {};
const planned = Array.isArray(agenda.planned) ? agenda.planned.filter((p) => p && p.id).map((p) => ({ id: p.id, date: p.date || '', time: p.time || '', place: p.place || '', note: p.note || '' }))
  .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')) : null;
const nextOf = () => { if (!planned) return agenda.next || {}; const n = planned[0]; return n ? { date: n.date, time: n.time, place: n.place, note: n.note } : {}; };
const WA_GROUP_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,}\/?$/;
const waGroupUrl = WA_GROUP_RE.test(String(bundle.waGroupUrl || '').trim()) ? String(bundle.waGroupUrl).trim() : '';
const generatedAt = bundle.generatedAt || new Date().toISOString();
const publishedTasks = (bundle.tasks || []).filter((t) => t.approved !== false).map(publishTask);

const payload = {
  v: 1,
  generatedAt,
  logUrl: bundle.logUrl || '',
  tasks: publishedTasks,
  meetings: bundle.meetings || [],
  topics: bundle.topics || {},   // { '<super-topic>': { goal, lead } } from meta/topics
  agenda: Object.assign({ next: nextOf(), free: (agenda.free || []).filter((x) => x.status === 'approved'), lastAttached: agenda.lastAttached || null }, planned ? { planned } : {}),
  waGroupUrl,
  // people: contact details for reminders are included only for active members
  people: (bundle.members || []).map((m) => ({ id: m.id, name: m.name, role: m.role || '', perms: (m.active !== false && m.perms) || null,
    phone: (m.active !== false && normPhone(m.phone)) || '', email: (m.active !== false && String(m.email || '').trim()) || '',
    lastLoginAt: m.lastLoginAt || '' })),
  // participants (version 1.8): never with codes; contact details only for active participants
  participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role || '', org: p.org || '', active: p.active !== false,
    phone: (p.active !== false && normPhone(p.phone)) || '', email: (p.active !== false && String(p.email || '').trim()) || '',
    lastLoginAt: p.lastLoginAt || '' })),
};

const sealed = await sealPayload(payload);
const entries = {};
for (const m of members) { const [id, e] = await wrapKey(sealed.rawKey, m); entries[id] = e; }

mkdirSync(outDir, { recursive: true });
const dataText = sealed.text;
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

// ── guest bundles (version 1.8): one encrypted file per active participant, wrapped only with his own code ──
const limor = (bundle.members || []).find((m) => m.id === 'm-limor' && m.active !== false);
const contact = limor ? { limor: { name: limor.name, phone: normPhone(limor.phone) || '' } } : {};
const visibleTo = (u, pid) => Array.isArray(u.visibleTo) && (u.visibleTo.includes('*') || u.visibleTo.includes(pid));
mkdirSync(outDir + '/guests', { recursive: true });
for (const f of readdirSync(outDir + '/guests')) if (/\.enc\.txt$/.test(f)) unlinkSync(outDir + '/guests/' + f);
const gentries = {};
let nGuestTasks = 0;
for (const p of guests) {
  const mine = publishedTasks.filter((t) => Array.isArray(t.participants) && t.participants.some((x) => x && x.id === p.id)).map((t) => {
    const a = t.participants.find((x) => x.id === p.id) || {};
    return { id: t.id, title: t.title, status: t.status, due: a.due || t.due || null, instruction: a.instruction || '', assignedAt: a.assignedAt || '',
      doneAt: t.doneAt || null, updates: (t.updates || []).filter((u) => visibleTo(u, p.id)).map((u) => ({ at: u.at, text: u.text, by: u.by || '', addedAt: u.addedAt || '', mine: u.byKind === 'guest' && (u.byId === p.id || (!u.byId && u.by === p.name)) })) };
  });
  nGuestTasks += mine.length;
  const gp = { v: 1, kind: 'guest', generatedAt, logUrl: bundle.logUrl || '', me: { id: p.id, name: p.name, role: p.role || '', org: p.org || '' }, tasks: mine, contact };
  const gs = await sealPayload(gp);
  const file = `guests/${p.id}.enc.txt`;
  writeFileSync(outDir + '/' + file, gs.text);
  const [lid, e] = await wrapKey(gs.rawKey, p, { f: file });
  gentries[lid] = e;
  if (gs.text.length > 60000) console.warn(`warning: ${file} is ${gs.text.length} chars; push_files may need it split`);
}
writeFileSync(outDir + '/guestkeys.json', JSON.stringify({ v: 1, iter: ITER, builtAt: payload.generatedAt, entries: gentries }));
console.log(`OK: ${payload.tasks.length} tasks, ${payload.meetings.length} meetings, ${members.length} member keys, ${dataText.length} bytes, ${parts.length} parts in ${outDir}/parts; ${guests.length} guest files (${nGuestTasks} assigned tasks) in ${outDir}/guests`);
