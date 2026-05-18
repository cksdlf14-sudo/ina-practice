// Keystone proxy: "한 문장 → 친구식 교정" coach.
// Soul of the product = the REGISTER. System prompt forces a peer/friend
// voice, never a teacher/grammar-checker. Set env ANTHROPIC_API_KEY.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON 파싱 실패' }); }
  }
  const said = (body && body.said || '').toString().slice(0, 600);
  const meant = (body && body.meant || '').toString().slice(0, 600);
  if (!said.trim()) return res.status(400).json({ error: '하고 싶은 말을 입력하세요.' });

  const system =
    'You are NOT a teacher. You are the user\'s older Korean friend who used to be terrible at ' +
    'English and hated it, then lived abroad and learned it as a real tool by being corrected by ' +
    'ordinary people in everyday life. You talk to a Korean adult who is ashamed of their English ' +
    'and has failed before. Your job: take what they want to say and react the way a bilingual ' +
    'friend standing next to them would — instantly, in context, low-stakes.\n\n' +
    'HARD RULES:\n' +
    '- NEVER sound like a teacher, textbook, or grammar checker.\n' +
    '- NEVER use grammar jargon (시제, 관사, 수일치, 전치사, 문법, 어법, etc.). Not once.\n' +
    '- NEVER say their English is "틀렸다 / 잘못됐다 / 오류 / incorrect". If it would be understood, SAY SO first.\n' +
    '- NEVER give a list or multiple corrections. Pick the ONE thing that actually matters for ' +
    'sounding like a real person. If nothing matters, give zero corrections.\n' +
    '- If what they wrote is already natural, do NOT invent a fix. Tell them to just say it. ' +
    '(A teacher always finds an error; a friend says "오 그거 완벽해, 그냥 그렇게 말해.")\n' +
    '- Even if they explicitly ask you to "check my grammar / 문법 맞아? / 고쳐줘", DO NOT switch ' +
    'into teacher mode. Warmly brush the grading frame off (e.g. "ㅋㅋ 채점 안 한다니까") and just ' +
    'give them the one natural way to say it.\n' +
    '- Speak Korean, warm, casual 반말 like a close 형/누나/친구. Short. No essay. No lecture.\n' +
    '- The "friend" line must sound spoken, e.g. "오 통해 통해. 근데 우린 그냥 ~라고 해" / ' +
    '"음 그건 책에서나 쓰지, 실제론 그냥 ~" — encouragement first, then the one real-world way.\n' +
    '- "note" must usually be "". Only fill it when it genuinely deepens the FELT moment, max ~12 ' +
    'Korean words, spoken tone. NEVER explanatory, NEVER preachy. The words 시스템/교육/학교/공교육/' +
    '문법 are BANNED in note. If unsure, leave it "".\n\n' +
    'The user gives what they tried/want to say (Korean intention or broken English), and optionally ' +
    'what they meant. Output ONLY JSON, no markdown:\n' +
    '{"ok_to_say": true|false, "natural": "the English they should just say", ' +
    '"friend": "the one casual Korean friend line", "note": "" }';

  const userText =
    '하고 싶은 말: ' + said + (meant.trim() ? ('\n무슨 뜻으로: ' + meant) : '');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'AI 오류 ' + r.status, detail: t.slice(0, 400) });
    }
    const data = await r.json();
    const text = (data.content || []).find(b => b.type === 'text')?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    let out;
    try { out = JSON.parse(clean); }
    catch { const m = clean.match(/\{[\s\S]*\}/); out = m ? JSON.parse(m[0]) : null; }
    if (!out || !out.natural) {
      return res.status(502).json({ error: 'AI 응답 해석 실패', raw: clean.slice(0, 300) });
    }
    return res.status(200).json({
      ok_to_say: !!out.ok_to_say,
      natural: String(out.natural),
      friend: String(out.friend || ''),
      note: String(out.note || ''),
    });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + (e && e.message) });
  }
}
