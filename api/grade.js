// Serverless proxy: hides the Anthropic API key from the browser.
// Deploy on Vercel (or any Node serverless host). Set env var ANTHROPIC_API_KEY.

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
  const { image, mime, numQuestions } = body || {};
  if (!image || !numQuestions) {
    return res.status(400).json({ error: 'image 와 numQuestions 가 필요합니다.' });
  }

  const system =
    'You are an exam answer-sheet reader for multiple-choice worksheets. ' +
    'The image is a worksheet a student has already filled in. ' +
    'For each question from 1 to ' + numQuestions + ', determine which single option ' +
    'the student selected (the circled, checked, ticked, or filled-in choice). ' +
    'Options are numbered 1,2,3,4,5 (or marked ①②③④⑤). ' +
    'Return ONLY a JSON array of exactly ' + numQuestions + ' integers, one per question in order. ' +
    'Use the option number the student chose. If a question is blank or you genuinely cannot tell, use 0. ' +
    'No markdown, no explanation. Example: [3,1,4,2,5]';

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
        max_tokens: 1500,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } },
            { type: 'text', text: '이 학습지 사진에서 학생이 각 문항에 표시한 답을 1번부터 ' + numQuestions + '번까지 순서대로 JSON 배열로만 답하세요.' },
          ],
        }],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: 'AI 오류 ' + r.status, detail: t.slice(0, 500) });
    }

    const data = await r.json();
    const text = (data.content || []).find(b => b.type === 'text')?.text || '[]';
    const clean = text.replace(/```json|```/g, '').trim();
    let answers;
    try {
      answers = JSON.parse(clean);
    } catch {
      const m = clean.match(/\[[\s\S]*\]/);
      answers = m ? JSON.parse(m[0]) : null;
    }
    if (!Array.isArray(answers)) {
      return res.status(502).json({ error: 'AI 응답을 해석하지 못했습니다.', raw: clean.slice(0, 300) });
    }
    answers = answers.map(n => (Number.isFinite(+n) ? +n : 0));
    return res.status(200).json({ answers });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + (e && e.message) });
  }
}
