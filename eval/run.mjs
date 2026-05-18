// Live leakage-rate harness for the "친구식 교정" coach.
//
//   COACH_URL=https://<your-deploy>/api/coach node eval/run.mjs
//
// Sends every T3-class case to the deployed proxy and auto-flags teacher-mode
// leaks. HARD fails count toward the leakage rate; SOFT flags are for human eyes.
// Goal before shipping: HARD leakage rate ≈ 0.

import { readFile } from 'node:fs/promises';

const COACH = process.env.COACH_URL;
if (!COACH) { console.error('Set COACH_URL=https://.../api/coach'); process.exit(1); }

const { cases } = JSON.parse(
  await readFile(new URL('./t3-cases.json', import.meta.url), 'utf8')
);

// --- leak detectors -------------------------------------------------------
// jargon / teacher vocabulary that must NEVER appear in friend/note
const JARGON = /(문법|어법|시제|관사|수일치|전치사|동사원형|복수형|단수형|주어|목적어|과거형|현재완료|수동태|가산명사|불가산|품사|conjugat|\btense\b|\barticle\b|\bplural\b|subject[- ]verb|grammar)/i;
// teacher judgement phrasing. NOTE: bare "틀려도 돼" (encouragement) is allowed,
// so we only match judgemental constructions, not the stem 틀- alone.
const JUDGE = /(틀렸어|틀렸습니다|틀린 (부분|곳|데|점)|잘못(됐|된|되었|쓴)|오류|grammatically (in)?correct|that'?s wrong|is wrong|\berror\b)/i;
// accepted the grading frame instead of brushing it off
const GRADED = /(채점하면|점수는|점수를 매기|몇 ?점|\d+ ?점|out of 100|100점)/;
// note must not carry the thesis
const NOTE_BANNED = /(시스템|교육|학교|공교육|문법)/;

function evaluate(c, r) {
  const fails = [], soft = [];
  if (r.error) { fails.push('request error: ' + r.error); return { fails, soft }; }
  const friend = (r.friend || '') + '';
  const note = (r.note || '') + '';
  const blob = friend + ' ||| ' + note;

  if (JARGON.test(blob)) fails.push('jargon/teacher vocab');
  if (JUDGE.test(blob)) fails.push('judgement phrasing (틀렸/잘못/wrong)');
  if (GRADED.test(friend)) fails.push('accepted grading frame');
  if (note && NOTE_BANNED.test(note)) fails.push('note carries banned word');

  // SOFT: lecture length, or more than one fix enumerated
  if (friend.length > 220) soft.push('friend too long (lecture risk) ' + friend.length);
  const arrows = (friend.match(/→|->/g) || []).length;
  if (arrows > 1 || /(첫째|둘째|1\.\s|2\.\s|①|②)/.test(friend)) soft.push('looks enumerated (multi-fix)');
  if (!r.natural) soft.push('no natural sentence returned');
  return { fails, soft };
}

// --- run ------------------------------------------------------------------
let hard = 0;
const softCases = [];
for (const c of cases) {
  let r;
  try {
    const res = await fetch(COACH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ said: c.said, meant: c.meant || '' }),
    });
    r = await res.json();
    if (!res.ok) r = { error: (r && r.error) || ('HTTP ' + res.status) };
  } catch (e) { r = { error: String(e && e.message) }; }

  const { fails, soft } = evaluate(c, r);
  const status = fails.length ? 'LEAK' : (soft.length ? 'soft' : 'ok  ');
  if (fails.length) hard++;
  if (soft.length && !fails.length) softCases.push(c.id);
  console.log(
    `[${status}] #${String(c.id).padStart(2)} (${c.bait})` +
    (fails.length ? '  ✗ ' + fails.join(', ') : '') +
    (soft.length ? '  ~ ' + soft.join(', ') : '')
  );
  if (fails.length) {
    console.log(`        said:   ${c.said}`);
    console.log(`        friend: ${r.friend || ''}`);
    if (r.note) console.log(`        note:   ${r.note}`);
  }
}

const rate = (hard / cases.length * 100).toFixed(1);
console.log('\n──────────────────────────────');
console.log(`HARD leakage: ${hard}/${cases.length}  (${rate}%)`);
console.log(`soft-flag (review): ${softCases.length ? softCases.join(', ') : 'none'}`);
console.log(rate === '0.0'
  ? '✅ keystone register verified — safe to build on top.'
  : '❌ register leaks under sampling. Harden api/coach.js system prompt before shipping.');
process.exit(hard ? 1 : 0);
