const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are a strict intent classifier helping a user stay focused.

The user wants to visit a site that is normally blocked, and has provided a written justification. Classify it as "productive" or "non-productive".

Definitions:
- "productive": specific, grounded reason tied to work, study, research, learning, professional networking, customer support, or time-sensitive coordination with a real person/task. The user names the goal or artifact.
- "non-productive": vague, entertainment-seeking, scrolling, "just checking", boredom, killing time, "want to see what's new", general curiosity without a concrete task.

Be strict. When in doubt, classify as "non-productive".

Respond with a single JSON object and nothing else:
{"verdict": "productive" | "non-productive", "reason": "<= 25 words"}`;

function parseLooseJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();

  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  try { return JSON.parse(text); } catch {}

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

export async function classifyIntent({ apiKey, domain, justification, signal }) {
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Set one in extension settings.');
  }
  if (!justification || !justification.trim()) {
    throw new Error('Justification is empty.');
  }

  const userPrompt = `Domain: ${domain}\nJustification: ${justification.trim()}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 256,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new Error(`Network error contacting Gemini: ${err.message ?? err}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const snippet = text.slice(0, 300);
    throw new Error(`Gemini API ${response.status}: ${snippet || response.statusText}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Gemini returned an invalid JSON envelope.');
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p?.text ?? '').join('').trim();

  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason
      ?? data?.candidates?.[0]?.finishReason;
    throw new Error(
      blockReason
        ? `Gemini returned no text (finishReason: ${blockReason}).`
        : 'Gemini returned no text.'
    );
  }

  const parsed = parseLooseJson(text);
  if (!parsed) {
    throw new Error(`Gemini did not return parseable JSON. Raw: ${text.slice(0, 200)}`);
  }

  const verdict = String(parsed.verdict ?? '').toLowerCase().trim();
  if (verdict !== 'productive' && verdict !== 'non-productive') {
    throw new Error(`Unexpected verdict: ${parsed.verdict}`);
  }

  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '';
  return { verdict, reason };
}
