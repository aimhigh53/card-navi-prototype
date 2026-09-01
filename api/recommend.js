export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.LUNA_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt5.6-Luna';

  if (!apiKey) {
    return res.status(500).json({
      error: 'AI_API_KEY가 Vercel 환경변수에 없습니다. gpt5.6-Luna API 키를 Vercel에 설정해야 추천이 동작합니다.'
    });
  }

  const input = req.body || {};
  const monthlySpend = Number(input.monthlySpend || 0);
  const ownedCards = Array.isArray(input.ownedCards) ? input.ownedCards.filter(Boolean) : [];
  if (!monthlySpend || monthlySpend < 10000) return res.status(400).json({ error: '월평균 사용금액을 입력해 주세요.' });
  if (!ownedCards.length) return res.status(400).json({ error: '소유 카드를 1개 이상 선택해 주세요.' });

  const system = `너는 한국 신용카드 사용 전략 컨설턴트다.
사용자가 소유한 카드와 월평균 카드 사용금액을 기반으로, 실제로 어떤 카드에 얼마를 쓰고 어떤 소비 카테고리에 배치할지 추천한다.
반드시 JSON만 반환한다. 과장하지 말고, 모르는 카드 혜택은 일반적인 카드명/카테고리 추론으로 보수적으로 설명한다.
금액 합계는 monthlySpend와 거의 일치해야 한다.
recommendations는 1~4개만 만들고, 선택하지 않은 카드는 avoidCards에 이유를 넣는다.
JSON schema:
{
  "summary":"한 줄 전략",
  "rationale":"전체 판단 이유 1~2문장",
  "recommendations":[{"card":"카드명","role":"주력 카드|보조 카드|고정비 카드|온라인 카드 등","monthlyAmount":number,"categories":["카테고리"],"reason":"왜 이 카드에 이 금액/카테고리를 배치하는지"}],
  "avoidCards":[{"card":"카드명","reason":"이번 달 굳이 쓰지 않을 이유"}],
  "cautions":["주의사항"]
}`;

  const user = JSON.stringify({
    monthlySpend,
    ownedCards,
    pattern: input.pattern,
    priority: input.priority,
    maxCards: input.maxCards,
    unknownMode: input.unknownMode
  }, null, 2);

  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `gpt5.6-Luna API 오류: ${text.slice(0, 500)}` });
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'AI 응답이 비어 있습니다.' });
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { parsed = extractJson(content); }
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'AI 추천 생성 중 오류가 발생했습니다.' });
  }
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI JSON 파싱 실패');
  return JSON.parse(text.slice(start, end + 1));
}
