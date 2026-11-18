/**
 * Supabase Edge Function: voc-pipeline
 * Deploy with:
 *   supabase secrets set GEMINI_API_KEY="your-key"
 *   supabase functions deploy voc-pipeline
 *
 * Executes discrete Gemini workflows server-side with structured JSON outputs
 * and stores results directly into the workspace's isolated Supabase tables.
 */

// Reference Deno Edge Function implementation aligned with server/ai/geminiPipeline.ts
// Uses server-side GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY secrets exclusively.

export const WORKFLOW_PROMPTS = {
  classification: `You are a Voice of Customer classification engine.
Classify each feedback item independently. Do not invent details.
Return strict JSON array with: feedback_id, category, product_area, problem_description, customer_intent, main_issue, confidence_score (0..1).`,

  sentiment: `You are a Voice of Customer sentiment analyst.
Classify sentiment strictly as one of: Positive, Negative, Neutral, Mixed, Uncertain.
Do NOT equate negative sentiment with high severity.
Explain ambiguity whenever sentiment is Mixed or Uncertain.`,

  theme_detection: `Group semantically similar customer feedback items into concrete, non-overlapping pain point themes.
Every theme must reference ONLY exact feedback_ids provided in the input. Never invent IDs or quotes.`,

  severity: `Evaluate each theme's severity as Low, Medium, or High based on:
1. Customer impact, 2. Frequency, 3. Business/revenue impact, 4. Urgency, 5. Customer segments affected.
Negative phrasing alone does NOT justify High severity. Explain reasoning concisely.`,

  opportunity_generation: `Transform each verified theme into a suggested product opportunity (NOT an automatic decision).
Include title, problem_statement, customer_impact, business_impact, proposed_solution, recommended_next_action, assumptions, risks, and suggested RICE inputs (reach, impact 0.25-3.0, confidence 10-100, effort in person-weeks).`,
};

export const EDGE_DEPLOYMENT_STEPS = [
  '1. Run supabase/migrations/001_initial_schema.sql in your Supabase SQL Editor.',
  '2. Set GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in your server environment.',
  '3. Optionally deploy this Edge Function via `supabase functions deploy voc-pipeline` and set `supabase secrets set GEMINI_API_KEY=...`.',
];
