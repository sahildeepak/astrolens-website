// netlify/functions/interpret.js
// Netlify Function for /api/interpret (keeps rulebook server-side)
// Uses a safe keyword fallback so the endpoint works without any LLM key.
// Replace callGeminiMockOrReal with a real Gemini call later and set NETLIFY env var GEMINI_API_KEY.

const VALID_MOUNTS = new Set(['jupiter','sun','saturn','mercury']);
const VALID_SIGNS = new Set(['cross','star','island','mole','vertical_line','vertical_lines','net']);

// Server-side Lal Kitab rules (DO NOT put this in the client)
const LAL_KITAB_RULES_JSON = [
  {
    conditions: { all: [ { fact: "mount", operator: "equal", value: "jupiter" }, { fact: "sign", operator: "equal", value: "cross" } ] },
    event: { type: "reading_match", params: { planet: "Jupiter (Guru)", age: 16, prediction: "The cross of Jupiter is auspicious and indicates a happy union and wealth through honorable means.", remedy: "Apply saffron (kesar) tilak on your forehead daily to strengthen your Guru." } }
  },
  {
    conditions: { all: [ { fact: "mount", operator: "equal", value: "sun" }, { fact: "sign", operator: "equal", value: "star" } ] },
    event: { type: "reading_match", params: { planet: "Sun (Surya)", age: 22, prediction: "A Star on the Sun mount indicates Raj Yoga and favor from authority.", remedy: "Offer water to the rising sun daily. Avoid accepting free gifts." } }
  },
  {
    conditions: { all: [ { fact: "mount", operator: "equal", value: "saturn" }, { fact: "sign", operator: "equal", value: "vertical_line" } ] },
    event: { type: "reading_match", params: { planet: "Saturn (Shani)", age: 36, prediction: "A vertical line on Saturn suggests wealth through iron, justice, or property.", remedy: "Pour oil on the ground (Chaya Daan) on Saturdays." } }
  },
  {
    conditions: { all: [ { fact: "mount", operator: "equal", value: "mercury" }, { fact: "sign", operator: "equal", value: "vertical_lines" } ] },
    event: { type: "reading_match", params: { planet: "Mercury (Budh)", age: 34, prediction: "The 'Healer's Mark' here signifies sharp business acumen and eloquence.", remedy: "Clean your teeth with alum (fitkari) or donate green clothes." } }
  },
  {
    conditions: {
      any: [
        { fact: "mount", operator: "equal", value: "jupiter" },
        { fact: "mount", operator: "equal", value: "sun" },
        { fact: "mount", operator: "equal", value: "saturn" },
        { fact: "mount", operator: "equal", value: "mercury" }
      ]
    },
    event: { type: "no_sign_match", params: { message: "I see the Mount, but the specific sign is unclear. This area typically governs ambition and destiny. Be patient." } }
  }
];

class RulesEngineLite {
  constructor(rules) { this.rules = rules; }
  run(facts) {
    for (const rule of this.rules) {
      const c = rule.conditions;
      if (c.all) {
        const allMatch = c.all.every(cond => cond.operator === 'equal' && facts[cond.fact] === cond.value);
        if (allMatch) return rule.event;
      }
      if (c.any) {
        const anyMatch = c.any.some(cond => cond.operator === 'equal' && facts[cond.fact] === cond.value);
        if (anyMatch && (facts.sign === null || facts.sign === undefined)) return rule.event;
      }
    }
    return null;
  }
}

const engine = new RulesEngineLite(LAL_KITAB_RULES_JSON);

function normalizeMount(m) {
  if (!m) return null;
  const s = String(m).toLowerCase().trim();
  return VALID_MOUNTS.has(s) ? s : null;
}
function normalizeSign(s) {
  if (!s) return null;
  const v = String(s).toLowerCase().trim();
  return VALID_SIGNS.has(v) ? v : null;
}

// Keyword fallback parser (works without Gemini key)
function keywordParse(text) {
  const lower = (text||'').toLowerCase();
  let mount = null, sign = null;
  if (/jupiter|index finger|guru/.test(lower)) mount = 'jupiter';
  if (/sun|ring finger|apollo/.test(lower)) mount = 'sun';
  if (/saturn|middle finger|fate/.test(lower)) mount = 'saturn';
  if (/mercury|little finger|pinky|little finger/.test(lower)) mount = 'mercury';
  if (/star/.test(lower)) sign = 'star';
  if (/cross| x\b/.test(lower)) sign = 'cross';
  if (/mole|spot/.test(lower)) sign = 'mole';
  if (/island|circle/.test(lower)) sign = 'island';
  if (/vertical lines|vertical line|straight line/.test(lower)) sign = lower.includes('lines') ? 'vertical_lines' : 'vertical_line';
  const confidence = (mount || sign) ? 0.6 : 0.15;
  return { mount, sign, confidence, provider: 'fallback' };
}

// Placeholder for Gemini call: if you later set NETLIFY env var GEMINI_API_KEY, replace this with actual call.
async function callGeminiIfConfigured(text) {
  // If not configured, just return fallback
  if (!process.env.GEMINI_API_KEY) return keywordParse(text);

  // Put your Gemini implementation here (server-side). For now we return fallback to keep you moving.
  return keywordParse(text);
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Only POST allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const text = body.text;
  if (!text || typeof text !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing "text" in body' }) };
  }

  try {
    const modelOut = await callGeminiIfConfigured(text);
    const mount = normalizeMount(modelOut.mount);
    const sign = normalizeSign(modelOut.sign);
    const confidence = (typeof modelOut.confidence === 'number') ? Math.max(0, Math.min(1, modelOut.confidence)) : 0;
    const facts = { mount, sign, confidence };

    const eventResult = engine.run(facts);

    const payload = {
      facts,
      event: eventResult ?? null,
      meta: { timestamp: new Date().toISOString(), provider: modelOut.provider || 'fallback' }
    };

    return { statusCode: 200, body: JSON.stringify(payload) };
  } catch (err) {
    console.error('interpret error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
