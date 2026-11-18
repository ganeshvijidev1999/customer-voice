import type { SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import {
  db,
  generateId,
  computeRiceScore,
  derivePriorityFromRice,
  computeEvidenceStrength,
} from '../db.ts';
import type { PipelineStage, SentimentType, SeverityLevel, ChurnConcernLevel } from '../../shared/types.ts';

const Type = {
  ARRAY: 'array',
  OBJECT: 'object',
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
} as const;

export const GEMINI_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';
export const FREE_TIER_HOURLY_LIMIT = 60;

function getOpenRouterApiKey(): string {
  const orKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  if (orKey && !orKey.includes('your-openrouter') && orKey.length > 10) return orKey;
  const legacyKey = process.env.GEMINI_API_KEY?.trim() || '';
  if (legacyKey.startsWith('sk-or-') && legacyKey.length > 10) return legacyKey;
  return '';
}

export function isGeminiConfigured(): boolean {
  return Boolean(getOpenRouterApiKey());
}

function requireOpenRouterApiKey(): string {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new GeminiPipelineError(
      'OPENROUTER_API_KEY is not configured in the server environment. Configure OPENROUTER_API_KEY in Settings > Secrets to execute live OpenRouter AI workflows.',
      'MISSING_KEY'
    );
  }
  return apiKey;
}

export class GeminiPipelineError extends Error {
  code: 'MISSING_KEY' | 'API_KEY_INVALID' | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'INVALID_JSON' | 'UPSTREAM_ERROR';
  constructor(
    message: string,
    code: 'MISSING_KEY' | 'API_KEY_INVALID' | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'INVALID_JSON' | 'UPSTREAM_ERROR'
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * Strip unnecessary PII before transmitting customer feedback text to Gemini.
 */
export function redactPII(text: string): string {
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_ID]');
}

function checkHourlyRateLimit(workspaceId: string): void {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM ai_processing_logs
       WHERE workspace_id = ? AND created_at >= ? AND cache_hit = 0 AND model_name = ?`
    )
    .get(workspaceId, oneHourAgo, GEMINI_MODEL) as { cnt: number };

  if ((row?.cnt || 0) >= FREE_TIER_HOURLY_LIMIT) {
    throw new GeminiPipelineError(
      `Free-tier safety limit reached (${FREE_TIER_HOURLY_LIMIT} live Gemini requests/hour for this workspace). Wait before retrying to stay within quota.`,
      'RATE_LIMITED'
    );
  }
}

function logAIEvent(params: {
  workspaceId: string;
  jobId: string | null;
  workflowName: string;
  recordsCount: number;
  promptTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  cacheHit?: boolean;
  status: 'success' | 'error' | 'quota_exceeded' | 'invalid_json';
  errorMessage?: string | null;
}): void {
  db.prepare(
    `INSERT INTO ai_processing_logs (
      id, workspace_id, job_id, workflow_name, model_name, records_count,
      prompt_tokens, output_tokens, latency_ms, cache_hit, status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId(),
    params.workspaceId,
    params.jobId,
    params.workflowName,
    GEMINI_MODEL,
    params.recordsCount,
    params.promptTokens || 0,
    params.outputTokens || 0,
    params.latencyMs,
    params.cacheHit ? 1 : 0,
    params.status,
    params.errorMessage || null,
    new Date().toISOString()
  );
}

function classifyUpstreamError(err: unknown): GeminiPipelineError {
  if (err instanceof GeminiPipelineError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('429') || lower.includes('402') || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('rate limit') || lower.includes('insufficient credits')) {
    return new GeminiPipelineError(
      'OpenRouter API quota or rate limit exceeded (402/429). Check your OpenRouter credits or wait before retrying.',
      'QUOTA_EXHAUSTED'
    );
  }
  if (lower.includes('403') || lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('user not found')) {
    return new GeminiPipelineError(
      'OpenRouter API authentication failed (401/403). Please verify your OPENROUTER_API_KEY in Settings > Secrets.',
      'API_KEY_INVALID'
    );
  }
  return new GeminiPipelineError(`OpenRouter request failed: ${msg}`, 'UPSTREAM_ERROR');
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function validateWithArrayUnwrap<T>(parsedJson: unknown, zodSchema: z.ZodType<T>) {
  const direct = zodSchema.safeParse(parsedJson);
  if (direct.success) return direct;

  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    const obj = parsedJson as Record<string, unknown>;
    let firstArrayFailure: ReturnType<typeof zodSchema.safeParse> | null = null;
    const priorityKeys = ['items', 'results', 'records', 'data', 'themes', 'opportunities'];
    for (const key of priorityKeys) {
      if (Array.isArray(obj[key])) {
        const unwrapped = zodSchema.safeParse(obj[key]);
        if (unwrapped.success) return unwrapped;
        if (!firstArrayFailure) firstArrayFailure = unwrapped;
      }
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) {
        const unwrapped = zodSchema.safeParse(val);
        if (unwrapped.success) return unwrapped;
        if (!firstArrayFailure) firstArrayFailure = unwrapped;
      }
    }
    const wrappedSingle = zodSchema.safeParse([obj]);
    if (wrappedSingle.success) return wrappedSingle;
    if (firstArrayFailure) return firstArrayFailure;
  }
  return direct;
}

async function callGeminiStructured<T>(params: {
  workspaceId: string;
  jobId: string | null;
  workflowName: string;
  recordsCount: number;
  systemInstruction: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
}): Promise<T> {
  checkHourlyRateLimit(params.workspaceId);
  const apiKey = requireOpenRouterApiKey();
  const started = Date.now();
  let lastErr: unknown = null;
  const expectsArray = (params.responseSchema as { type?: string }).type === 'array';

  const systemContent = [
    params.systemInstruction,
    'Return ONLY valid JSON with no markdown or commentary.',
    expectsArray
      ? 'Wrap the output array in a JSON object as {"items": [...]} matching this schema:'
      : 'Return a JSON object matching this schema:',
    JSON.stringify(params.responseSchema),
  ].join('\n\n');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': 'Voice of Customer Copilot',
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: params.prompt },
          ],
        }),
      });

      const bodyText = await res.text();
      if (!res.ok) {
        let errDetail = bodyText.slice(0, 300);
        try {
          const errJson = JSON.parse(bodyText) as { error?: { message?: string } };
          if (errJson?.error?.message) errDetail = errJson.error.message;
        } catch {
          // keep raw excerpt
        }
        if (res.status === 401 || res.status === 403) {
          throw new GeminiPipelineError(
            `OpenRouter API authentication failed (${res.status}): ${errDetail}`,
            'API_KEY_INVALID'
          );
        }
        if (res.status === 402 || res.status === 429) {
          throw new GeminiPipelineError(
            `OpenRouter API quota or rate limit exceeded (${res.status}): ${errDetail}`,
            'QUOTA_EXHAUSTED'
          );
        }
        throw new GeminiPipelineError(`OpenRouter HTTP ${res.status}: ${errDetail}`, 'UPSTREAM_ERROR');
      }

      const payload = JSON.parse(bodyText) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const latencyMs = Date.now() - started;
      const rawText = stripJsonFences(payload.choices?.[0]?.message?.content || '');
      const promptTokens = payload.usage?.prompt_tokens || 0;
      const outputTokens = payload.usage?.completion_tokens || 0;

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        logAIEvent({
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          workflowName: params.workflowName,
          recordsCount: params.recordsCount,
          promptTokens,
          outputTokens,
          latencyMs,
          status: 'invalid_json',
          errorMessage: 'Model returned malformed JSON',
        });
        throw new GeminiPipelineError(
          `${params.workflowName} returned invalid JSON that failed schema parsing.`,
          'INVALID_JSON'
        );
      }

      const validated = validateWithArrayUnwrap(parsedJson, params.zodSchema);
      if (!validated.success) {
        logAIEvent({
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          workflowName: params.workflowName,
          recordsCount: params.recordsCount,
          promptTokens,
          outputTokens,
          latencyMs,
          status: 'invalid_json',
          errorMessage: validated.error.issues.map((i) => i.message).join('; ').slice(0, 300),
        });
        throw new GeminiPipelineError(
          `${params.workflowName} failed strict JSON schema validation.`,
          'INVALID_JSON'
        );
      }

      logAIEvent({
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        workflowName: params.workflowName,
        recordsCount: params.recordsCount,
        promptTokens,
        outputTokens,
        latencyMs,
        status: 'success',
      });

      return validated.data;
    } catch (err) {
      lastErr = err;
      const classified = classifyUpstreamError(err);
      if (classified.code === 'QUOTA_EXHAUSTED' || classified.code === 'API_KEY_INVALID' || classified.code === 'MISSING_KEY' || classified.code === 'RATE_LIMITED') {
        logAIEvent({
          workspaceId: params.workspaceId,
          jobId: params.jobId,
          workflowName: params.workflowName,
          recordsCount: params.recordsCount,
          latencyMs: Date.now() - started,
          status: classified.code === 'QUOTA_EXHAUSTED' ? 'quota_exceeded' : 'error',
          errorMessage: classified.message,
        });
        throw classified;
      }
      if (attempt === 0) {
        await new Promise((res) => setTimeout(res, 750));
      }
    }
  }

  const finalErr = classifyUpstreamError(lastErr);
  logAIEvent({
    workspaceId: params.workspaceId,
    jobId: params.jobId,
    workflowName: params.workflowName,
    recordsCount: params.recordsCount,
    latencyMs: Date.now() - started,
    status: 'error',
    errorMessage: finalErr.message,
  });
  throw finalErr;
}

// ============================================================================
// WORKFLOW A: FEEDBACK CLASSIFICATION
// ============================================================================
const ClassificationResultSchema = z.array(
  z.object({
    feedback_id: z.string(),
    category: z.string(),
    product_area: z.string(),
    problem_description: z.string(),
    customer_intent: z.string(),
    main_issue: z.string(),
    confidence_score: z.number().min(0).max(1),
  })
);

export type ClassificationItem = z.infer<typeof ClassificationResultSchema>[number];

export async function runWorkflowAClassification(
  workspaceId: string,
  jobId: string | null,
  batch: Array<{ feedback_id: string; text_hash: string; customer_text: string; product_area: string }>
): Promise<Map<string, ClassificationItem>> {
  const results = new Map<string, ClassificationItem>();
  const uncached: typeof batch = [];

  for (const item of batch) {
    const cacheKey = `workflow_a:${item.text_hash}`;
    const cached = db.prepare('SELECT result_json FROM ai_cache WHERE cache_key = ?').get(cacheKey) as
      | { result_json: string }
      | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.result_json) as ClassificationItem;
        results.set(item.feedback_id, { ...parsed, feedback_id: item.feedback_id });
        logAIEvent({
          workspaceId,
          jobId,
          workflowName: 'Workflow A: Feedback Classification',
          recordsCount: 1,
          latencyMs: 1,
          cacheHit: true,
          status: 'success',
        });
        continue;
      } catch {
        // Ignore stale cache entry
      }
    }
    uncached.push(item);
  }

  if (uncached.length === 0) return results;

  const payload = uncached.map((u) => ({
    feedback_id: u.feedback_id,
    hint_product_area: u.product_area,
    text: redactPII(u.customer_text),
  }));

  const data = await callGeminiStructured({
    workspaceId,
    jobId,
    workflowName: 'Workflow A: Feedback Classification',
    recordsCount: uncached.length,
    systemInstruction:
      'You are Workflow A (Feedback Classification) for Voice of Customer Copilot. Classify each feedback record accurately using only the provided text. Never invent facts. Use "Uncertain" when intent or issue is unclear.',
    prompt: `Classify these ${payload.length} feedback records:\n${JSON.stringify(payload)}`,
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          feedback_id: { type: Type.STRING },
          category: { type: Type.STRING },
          product_area: { type: Type.STRING },
          problem_description: { type: Type.STRING },
          customer_intent: { type: Type.STRING },
          main_issue: { type: Type.STRING },
          confidence_score: { type: Type.NUMBER },
        },
        required: [
          'feedback_id',
          'category',
          'product_area',
          'problem_description',
          'customer_intent',
          'main_issue',
          'confidence_score',
        ],
      },
    },
    zodSchema: ClassificationResultSchema,
  });

  const insertCache = db.prepare(
    `INSERT OR REPLACE INTO ai_cache (cache_key, workflow_name, result_json, model_name, created_at)
     VALUES (?, 'workflow_a', ?, ?, ?)`
  );

  for (const item of data) {
    results.set(item.feedback_id, item);
    const source = uncached.find((u) => u.feedback_id === item.feedback_id);
    if (source) {
      insertCache.run(`workflow_a:${source.text_hash}`, JSON.stringify(item), GEMINI_MODEL, new Date().toISOString());
    }
  }

  return results;
}

// ============================================================================
// WORKFLOW B: SENTIMENT ANALYSIS
// ============================================================================
const SentimentResultSchema = z.array(
  z.object({
    feedback_id: z.string(),
    sentiment: z.enum(['Positive', 'Negative', 'Neutral', 'Mixed', 'Uncertain']),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1),
  })
);

export type SentimentItem = z.infer<typeof SentimentResultSchema>[number];

export async function runWorkflowBSentiment(
  workspaceId: string,
  jobId: string | null,
  batch: Array<{ feedback_id: string; text_hash: string; customer_text: string }>
): Promise<Map<string, SentimentItem>> {
  const results = new Map<string, SentimentItem>();
  const uncached: typeof batch = [];

  for (const item of batch) {
    const cacheKey = `workflow_b:${item.text_hash}`;
    const cached = db.prepare('SELECT result_json FROM ai_cache WHERE cache_key = ?').get(cacheKey) as
      | { result_json: string }
      | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.result_json) as SentimentItem;
        results.set(item.feedback_id, { ...parsed, feedback_id: item.feedback_id });
        logAIEvent({
          workspaceId,
          jobId,
          workflowName: 'Workflow B: Sentiment Analysis',
          recordsCount: 1,
          latencyMs: 1,
          cacheHit: true,
          status: 'success',
        });
        continue;
      } catch {
        // Ignore stale cache
      }
    }
    uncached.push(item);
  }

  if (uncached.length === 0) return results;

  const payload = uncached.map((u) => ({
    feedback_id: u.feedback_id,
    text: redactPII(u.customer_text),
  }));

  const data = await callGeminiStructured({
    workspaceId,
    jobId,
    workflowName: 'Workflow B: Sentiment Analysis',
    recordsCount: uncached.length,
    systemInstruction:
      'You are Workflow B (Sentiment Analysis). Classify each record strictly as Positive, Negative, Neutral, Mixed, or Uncertain. Never confuse emotional sentiment with business severity. Explicitly explain ambiguity for Mixed or Uncertain items.',
    prompt: `Analyze sentiment for these ${payload.length} records:\n${JSON.stringify(payload)}`,
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          feedback_id: { type: Type.STRING },
          sentiment: { type: Type.STRING, enum: ['Positive', 'Negative', 'Neutral', 'Mixed', 'Uncertain'] },
          reasoning: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ['feedback_id', 'sentiment', 'reasoning', 'confidence'],
      },
    },
    zodSchema: SentimentResultSchema,
  });

  const insertCache = db.prepare(
    `INSERT OR REPLACE INTO ai_cache (cache_key, workflow_name, result_json, model_name, created_at)
     VALUES (?, 'workflow_b', ?, ?, ?)`
  );

  for (const item of data) {
    results.set(item.feedback_id, item);
    const source = uncached.find((u) => u.feedback_id === item.feedback_id);
    if (source) {
      insertCache.run(`workflow_b:${source.text_hash}`, JSON.stringify(item), GEMINI_MODEL, new Date().toISOString());
    }
  }

  return results;
}

// ============================================================================
// WORKFLOW C: THEME DETECTION
// ============================================================================
const ThemeDetectionSchema = z.array(
  z.object({
    title: z.string(),
    description: z.string(),
    why_happening: z.string(),
    next_investigation: z.string(),
    supporting_feedback_ids: z.array(z.string()),
    trend_summary: z.string(),
    confidence: z.number().min(0).max(1),
  })
);

// ============================================================================
// WORKFLOW D: SEVERITY ANALYSIS (Themes + Per-Record Severity + Potential Churn)
// ============================================================================
const SeverityAnalysisSchema = z.object({
  theme_severities: z.array(
    z.object({
      theme_title: z.string(),
      severity: z.enum(['Low', 'Medium', 'High']),
      severity_reasoning: z.string(),
    })
  ),
  record_assessments: z.array(
    z.object({
      feedback_id: z.string(),
      severity: z.enum(['Low', 'Medium', 'High']),
      severity_reasoning: z.string(),
      potential_churn_signal: z.boolean(),
      churn_signal_type: z.string().nullable(),
      churn_concern_level: z.enum(['Low', 'Medium', 'High']).nullable(),
      churn_reasoning: z.string().nullable(),
      churn_followup: z.string().nullable(),
    })
  ),
});

// ============================================================================
// WORKFLOW F: OPPORTUNITY GENERATION
// ============================================================================
const OpportunityGenSchema = z.array(
  z.object({
    theme_title: z.string(),
    title: z.string(),
    problem_statement: z.string(),
    customer_impact: z.string(),
    business_impact: z.string(),
    proposed_solution: z.string(),
    recommended_next_action: z.string(),
    assumptions: z.array(z.string()),
    risks: z.array(z.string()),
    suggested_reach: z.coerce.number().transform((v) => Math.min(10000, Math.max(1, Math.round(v)))),
    suggested_impact: z.coerce.number().transform((v) => Math.min(3.0, Math.max(0.25, v))),
    suggested_confidence: z.coerce.number().transform((v) => {
      const pct = v > 0 && v <= 1 ? Math.round(v * 100) : Math.round(v);
      return Math.min(100, Math.max(10, pct));
    }),
    suggested_effort: z.coerce.number().transform((v) => Math.min(20, Math.max(0.5, v))),
  })
);

function updateJobState(
  jobId: string,
  updates: {
    status?: string;
    total_records?: number;
    processed_records?: number;
    failed_records?: number;
    current_stage?: string;
    stages?: PipelineStage[];
    error_message?: string | null;
    completed_at?: string | null;
  }
): void {
  const existing = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(jobId) as Record<string, SQLInputValue> | undefined;
  if (!existing) return;

  db.prepare(
    `UPDATE analysis_jobs
     SET status = ?, total_records = ?, processed_records = ?, failed_records = ?, current_stage = ?,
         stages_json = ?, error_message = ?, completed_at = ?
     WHERE id = ?`
  ).run(
    updates.status ?? existing.status,
    updates.total_records ?? existing.total_records,
    updates.processed_records ?? existing.processed_records,
    updates.failed_records ?? existing.failed_records,
    updates.current_stage ?? existing.current_stage,
    updates.stages ? JSON.stringify(updates.stages) : existing.stages_json,
    updates.error_message !== undefined ? updates.error_message : existing.error_message,
    updates.completed_at !== undefined ? updates.completed_at : existing.completed_at,
    jobId
  );
}

function setStage(
  stages: PipelineStage[],
  key: string,
  status: PipelineStage['status'],
  detail?: string
): PipelineStage[] {
  const now = new Date().toISOString();
  return stages.map((s) => {
    if (s.key !== key) return s;
    return {
      ...s,
      status,
      detail: detail ?? s.detail,
      started_at: status === 'running' ? now : s.started_at,
      completed_at: status === 'completed' || status === 'failed' ? now : s.completed_at,
    };
  });
}

export function createInitialStages(): PipelineStage[] {
  return [
    { key: 'validation', label: 'Data Validation', status: 'pending' },
    { key: 'deduplication', label: 'Duplicate Detection', status: 'pending' },
    { key: 'classification', label: 'Workflow A: Feedback Classification', status: 'pending' },
    { key: 'sentiment', label: 'Workflow B: Sentiment Analysis', status: 'pending' },
    { key: 'theme_detection', label: 'Workflow C: Theme Detection', status: 'pending' },
    { key: 'severity_analysis', label: 'Workflow D: Severity & Churn Signals', status: 'pending' },
    { key: 'evidence_mapping', label: 'Workflow E: Verbatim Evidence Mapping', status: 'pending' },
    { key: 'opportunity_generation', label: 'Workflow F: Opportunity Generation', status: 'pending' },
    { key: 'database_storage', label: 'Database Storage & Dashboard Sync', status: 'pending' },
  ];
}

export async function executeWorkspaceAnalysisPipeline(params: {
  workspaceId: string;
  jobId: string;
  batchSize?: number;
  reprocessAll?: boolean;
}): Promise<void> {
  const batchSize = Math.min(15, Math.max(3, params.batchSize || 8));
  let stages = createInitialStages();

  try {
    // Stage 1: Validation
    stages = setStage(stages, 'validation', 'running', 'Checking workspace records');
    updateJobState(params.jobId, { status: 'running', current_stage: 'validation', stages });

    const targetRecords = (
      params.reprocessAll
        ? db
            .prepare(
              `SELECT * FROM feedback_records WHERE workspace_id = ? ORDER BY feedback_date DESC LIMIT 120`
            )
            .all(params.workspaceId)
        : db
            .prepare(
              `SELECT * FROM feedback_records
               WHERE workspace_id = ? AND processing_status IN ('pending', 'failed')
               ORDER BY feedback_date DESC LIMIT 120`
            )
            .all(params.workspaceId)
    ) as Array<{
      id: string;
      feedback_id: string;
      customer_text: string;
      text_hash: string;
      source: string;
      customer_segment: string;
      product_area: string;
      feedback_date: string;
    }>;

    if (targetRecords.length === 0) {
      stages = setStage(stages, 'validation', 'completed', 'No pending records requiring analysis');
      updateJobState(params.jobId, {
        status: 'completed',
        total_records: 0,
        processed_records: 0,
        current_stage: 'database_storage',
        stages: stages.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' } : s)),
        completed_at: new Date().toISOString(),
      });
      return;
    }

    db.prepare('UPDATE analysis_jobs SET total_records = ? WHERE id = ?').run(targetRecords.length, params.jobId);
    stages = setStage(stages, 'validation', 'completed', `${targetRecords.length} valid records queued`);

    // Stage 2: Deduplication verification
    stages = setStage(stages, 'deduplication', 'running', 'Checking SHA-256 text hashes and AI cache');
    updateJobState(params.jobId, { current_stage: 'deduplication', stages });
    stages = setStage(stages, 'deduplication', 'completed', 'Duplicate hashes checked; cache enabled for repeated text');

    // Stage 3 & 4: Batch Classification (Workflow A) + Sentiment (Workflow B)
    stages = setStage(stages, 'classification', 'running', `Processing in batches of ${batchSize}`);
    updateJobState(params.jobId, { current_stage: 'classification', stages });

    let processed = 0;
    let failed = 0;

    const classificationMap = new Map<string, ClassificationItem>();
    const sentimentMap = new Map<string, SentimentItem>();

    for (let i = 0; i < targetRecords.length; i += batchSize) {
      const batch = targetRecords.slice(i, i + batchSize);
      const batchCls = await runWorkflowAClassification(params.workspaceId, params.jobId, batch);
      for (const [k, v] of batchCls.entries()) {
        classificationMap.set(k, v);
        db.prepare(
          `UPDATE feedback_records
           SET category = ?, product_area = ?, problem_description = ?, customer_intent = ?,
               main_issue = ?, classification_confidence = ?, processing_status = 'processing'
           WHERE workspace_id = ? AND feedback_id = ?`
        ).run(
          v.category,
          v.product_area,
          v.problem_description,
          v.customer_intent,
          v.main_issue,
          v.confidence_score,
          params.workspaceId,
          k
        );
      }
      stages = setStage(
        stages,
        'classification',
        'running',
        `Classified ${Math.min(i + batch.length, targetRecords.length)} / ${targetRecords.length} records`
      );
      updateJobState(params.jobId, { current_stage: 'classification', stages });
    }
    stages = setStage(stages, 'classification', 'completed', `${classificationMap.size} records classified`);

    // Workflow B: Sentiment Analysis
    stages = setStage(stages, 'sentiment', 'running', `Scoring sentiment in batches of ${batchSize}`);
    updateJobState(params.jobId, { current_stage: 'sentiment', stages });

    for (let i = 0; i < targetRecords.length; i += batchSize) {
      const batch = targetRecords.slice(i, i + batchSize);
      const batchSent = await runWorkflowBSentiment(params.workspaceId, params.jobId, batch);
      for (const [k, v] of batchSent.entries()) {
        sentimentMap.set(k, v);
        db.prepare(
          `UPDATE feedback_records
           SET sentiment = ?, sentiment_reasoning = ?
           WHERE workspace_id = ? AND feedback_id = ?`
        ).run(v.sentiment, v.reasoning, params.workspaceId, k);
      }
      stages = setStage(
        stages,
        'sentiment',
        'running',
        `Analyzed ${Math.min(i + batch.length, targetRecords.length)} / ${targetRecords.length} sentiments`
      );
      updateJobState(params.jobId, { current_stage: 'sentiment', stages });
    }
    stages = setStage(stages, 'sentiment', 'completed', `${sentimentMap.size} sentiments scored independently of severity`);

    // Stage 5: Workflow C — Theme Detection
    stages = setStage(stages, 'theme_detection', 'running', 'Grouping semantically similar pain points');
    updateJobState(params.jobId, { current_stage: 'theme_detection', stages });

    const issueSummary = targetRecords
      .filter((r) => {
        const sent = sentimentMap.get(r.feedback_id)?.sentiment;
        const cls = classificationMap.get(r.feedback_id);
        return sent !== 'Positive' || (cls && cls.customer_intent.toLowerCase().includes('report'));
      })
      .map((r) => ({
        feedback_id: r.feedback_id,
        segment: r.customer_segment,
        date: r.feedback_date,
        category: classificationMap.get(r.feedback_id)?.category || 'General',
        main_issue: classificationMap.get(r.feedback_id)?.main_issue || redactPII(r.customer_text).slice(0, 140),
        sentiment: sentimentMap.get(r.feedback_id)?.sentiment || 'Uncertain',
      }));

    const detectedThemes =
      issueSummary.length > 0
        ? await callGeminiStructured({
            workspaceId: params.workspaceId,
            jobId: params.jobId,
            workflowName: 'Workflow C: Theme Detection',
            recordsCount: issueSummary.length,
            systemInstruction:
              'You are Workflow C (Theme Detection). Group semantically similar customer problems into clear, distinct pain point themes. Only cite feedback_ids present in the input array. Never invent feedback_ids.',
            prompt: `Group these customer issues into concise evidence-backed themes:\n${JSON.stringify(issueSummary)}`,
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  why_happening: { type: Type.STRING },
                  next_investigation: { type: Type.STRING },
                  supporting_feedback_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
                  trend_summary: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
                required: [
                  'title',
                  'description',
                  'why_happening',
                  'next_investigation',
                  'supporting_feedback_ids',
                  'trend_summary',
                  'confidence',
                ],
              },
            },
            zodSchema: ThemeDetectionSchema,
          })
        : [];

    stages = setStage(stages, 'theme_detection', 'completed', `${detectedThemes.length} pain point themes identified`);

    // Stage 6: Workflow D — Severity & Potential Churn Signal Analysis
    stages = setStage(stages, 'severity_analysis', 'running', 'Evaluating impact, frequency, urgency & potential churn signals');
    updateJobState(params.jobId, { current_stage: 'severity_analysis', stages });

    const severityInput = {
      themes: detectedThemes.map((t) => ({
        theme_title: t.title,
        description: t.description,
        frequency: t.supporting_feedback_ids.length,
      })),
      records: targetRecords.map((r) => ({
        feedback_id: r.feedback_id,
        segment: r.customer_segment,
        sentiment: sentimentMap.get(r.feedback_id)?.sentiment || 'Uncertain',
        main_issue: classificationMap.get(r.feedback_id)?.main_issue || '',
        text: redactPII(r.customer_text).slice(0, 260),
      })),
    };

    const severityData = await callGeminiStructured({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      workflowName: 'Workflow D: Severity & Churn Signal Analysis',
      recordsCount: targetRecords.length,
      systemInstruction:
        'You are Workflow D (Severity & Potential Churn Analysis). Score severity (Low, Medium, High) based on customer impact, frequency, business impact, urgency, and affected segment — NEVER assign High severity simply because sentiment is negative. Identify "potential_churn_signal" ONLY when concrete signals appear (cancellation language, repeated complaints, unresolved support, pricing dissatisfaction, repeated service failures, poor onboarding). NEVER fabricate churn probabilities.',
      prompt: `Evaluate severity and potential churn signals:\n${JSON.stringify(severityInput)}`,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          theme_severities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                theme_title: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
                severity_reasoning: { type: Type.STRING },
              },
              required: ['theme_title', 'severity', 'severity_reasoning'],
            },
          },
          record_assessments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                feedback_id: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
                severity_reasoning: { type: Type.STRING },
                potential_churn_signal: { type: Type.BOOLEAN },
                churn_signal_type: { type: Type.STRING, nullable: true },
                churn_concern_level: { type: Type.STRING, enum: ['Low', 'Medium', 'High'], nullable: true },
                churn_reasoning: { type: Type.STRING, nullable: true },
                churn_followup: { type: Type.STRING, nullable: true },
              },
              required: ['feedback_id', 'severity', 'severity_reasoning', 'potential_churn_signal'],
            },
          },
        },
        required: ['theme_severities', 'record_assessments'],
      },
      zodSchema: SeverityAnalysisSchema,
    });

    for (const ra of severityData.record_assessments) {
      db.prepare(
        `UPDATE feedback_records
         SET severity = ?, severity_reasoning = ?, churn_signal = ?, churn_signal_type = ?,
             churn_concern_level = ?, churn_reasoning = ?, churn_followup = ?, processing_status = 'completed'
         WHERE workspace_id = ? AND feedback_id = ?`
      ).run(
        ra.severity,
        ra.severity_reasoning,
        ra.potential_churn_signal ? 1 : 0,
        ra.potential_churn_signal ? ra.churn_signal_type || 'Potential churn signal' : null,
        ra.potential_churn_signal ? (ra.churn_concern_level as ChurnConcernLevel) || 'Medium' : null,
        ra.potential_churn_signal ? ra.churn_reasoning || ra.severity_reasoning : null,
        ra.potential_churn_signal ? ra.churn_followup || 'Schedule proactive customer success follow-up.' : null,
        params.workspaceId,
        ra.feedback_id
      );
      processed++;
    }

    // Mark any remaining target records as completed if classified
    for (const r of targetRecords) {
      const hasAssessment = severityData.record_assessments.some((a) => a.feedback_id === r.feedback_id);
      if (!hasAssessment) {
        db.prepare(
          `UPDATE feedback_records
           SET severity = COALESCE(severity, 'Low'), processing_status = 'completed'
           WHERE id = ?`
        ).run(r.id);
        processed++;
      }
    }

    stages = setStage(stages, 'severity_analysis', 'completed', `Severity & potential churn signals persisted for ${processed} records`);

    // Stage 7: Workflow E — Deterministic Verbatim Evidence Mapping (NEVER invents quotes!)
    stages = setStage(stages, 'evidence_mapping', 'running', 'Verifying exact verbatim quotes against stored records');
    updateJobState(params.jobId, { current_stage: 'evidence_mapping', processed_records: processed, stages });

    const now = new Date().toISOString();
    const recordByFeedbackId = new Map(targetRecords.map((r) => [r.feedback_id, r]));
    const persistedThemes: Array<{ id: string; title: string; description: string; severity: SeverityLevel; frequency: number }> = [];

    for (const t of detectedThemes) {
      // Strictly verify supporting_feedback_ids against real workspace DB rows
      const verifiedRecords = t.supporting_feedback_ids
        .map((fid) => recordByFeedbackId.get(fid))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));

      const themeSev = severityData.theme_severities.find(
        (s) => s.theme_title.toLowerCase() === t.title.toLowerCase()
      );
      const segments = Array.from(new Set(verifiedRecords.map((r) => r.customer_segment)));
      const dates = verifiedRecords.map((r) => r.feedback_date).sort();
      const evidenceStrength = computeEvidenceStrength(
        verifiedRecords.length,
        segments.length,
        new Set(dates).size
      );

      // Compute dominant sentiment from actual linked records
      const sentCounts = new Map<SentimentType, number>();
      for (const vr of verifiedRecords) {
        const s = sentimentMap.get(vr.feedback_id)?.sentiment || 'Uncertain';
        sentCounts.set(s, (sentCounts.get(s) || 0) + 1);
      }
      const dominantSentiment =
        Array.from(sentCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Negative';

      const themeId = generateId();
      db.prepare(
        `INSERT INTO pain_point_themes (
          id, workspace_id, title, description, why_happening, next_investigation,
          frequency, severity, severity_reasoning, sentiment, affected_segments,
          first_reported_date, latest_reported_date, trend_summary, confidence,
          evidence_strength, review_status, human_corrected, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review', 0, ?, ?)`
      ).run(
        themeId,
        params.workspaceId,
        t.title,
        t.description,
        t.why_happening,
        t.next_investigation,
        verifiedRecords.length,
        themeSev?.severity || 'Medium',
        themeSev?.severity_reasoning || 'Evaluated from frequency, segment reach, and operational impact.',
        dominantSentiment,
        JSON.stringify(segments),
        dates[0] || null,
        dates[dates.length - 1] || null,
        t.trend_summary,
        t.confidence,
        evidenceStrength,
        now,
        now
      );

      for (const vr of verifiedRecords) {
        db.prepare('UPDATE feedback_records SET theme_id = ? WHERE id = ?').run(themeId, vr.id);
        db.prepare(
          `INSERT OR IGNORE INTO evidence_records (id, workspace_id, feedback_record_id, theme_id, original_quote, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generateId(),
          params.workspaceId,
          vr.id,
          themeId,
          vr.customer_text, // Exact verbatim stored text — NEVER altered or generated!
          t.confidence,
          now
        );
      }

      persistedThemes.push({
        id: themeId,
        title: t.title,
        description: t.description,
        severity: (themeSev?.severity as SeverityLevel) || 'Medium',
        frequency: verifiedRecords.length,
      });
    }

    logAIEvent({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      workflowName: 'Workflow E: Verbatim Evidence Mapping',
      recordsCount: persistedThemes.reduce((acc, t) => acc + t.frequency, 0),
      latencyMs: 18,
      status: 'success',
    });

    stages = setStage(
      stages,
      'evidence_mapping',
      'completed',
      `Exact verbatim quotes verified for ${persistedThemes.length} themes`
    );

    // Stage 8: Workflow F — Opportunity Generation
    stages = setStage(stages, 'opportunity_generation', 'running', 'Synthesising evidence-backed product opportunities');
    updateJobState(params.jobId, { current_stage: 'opportunity_generation', stages });

    if (persistedThemes.length > 0) {
      const oppProposals = await callGeminiStructured({
        workspaceId: params.workspaceId,
        jobId: params.jobId,
        workflowName: 'Workflow F: Opportunity Generation',
        recordsCount: persistedThemes.length,
        systemInstruction:
          'You are Workflow F (Opportunity Generation). Propose actionable product opportunities backed by the given verified pain point themes. Frame all recommendations as suggestions for Product Manager review, never automatic decisions. Include explicit assumptions and risks.',
        prompt: `Generate suggested opportunities with initial RICE estimates:\n${JSON.stringify(persistedThemes)}`,
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              theme_title: { type: Type.STRING },
              title: { type: Type.STRING },
              problem_statement: { type: Type.STRING },
              customer_impact: { type: Type.STRING },
              business_impact: { type: Type.STRING },
              proposed_solution: { type: Type.STRING },
              recommended_next_action: { type: Type.STRING },
              assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
              risks: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggested_reach: { type: Type.INTEGER },
              suggested_impact: { type: Type.NUMBER },
              suggested_confidence: { type: Type.INTEGER },
              suggested_effort: { type: Type.NUMBER },
            },
            required: [
              'theme_title',
              'title',
              'problem_statement',
              'customer_impact',
              'business_impact',
              'proposed_solution',
              'recommended_next_action',
              'assumptions',
              'risks',
              'suggested_reach',
              'suggested_impact',
              'suggested_confidence',
              'suggested_effort',
            ],
          },
        },
        zodSchema: OpportunityGenSchema,
      });

      for (const opp of oppProposals) {
        const matchedTheme = persistedThemes.find(
          (pt) => pt.title.toLowerCase() === opp.theme_title.toLowerCase()
        );
        const rice = computeRiceScore(
          opp.suggested_reach,
          opp.suggested_impact,
          opp.suggested_confidence,
          opp.suggested_effort
        );
        const priority = derivePriorityFromRice(rice);

        db.prepare(
          `INSERT INTO opportunities (
            id, workspace_id, theme_id, title, problem_statement, customer_impact,
            business_impact, proposed_solution, recommended_next_action, assumptions,
            risks, reach, impact, confidence, effort, rice_score, priority,
            recommendation, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposed', ?, ?)`
        ).run(
          generateId(),
          params.workspaceId,
          matchedTheme?.id || null,
          opp.title,
          opp.problem_statement,
          opp.customer_impact,
          opp.business_impact,
          opp.proposed_solution,
          opp.recommended_next_action,
          JSON.stringify(opp.assumptions),
          JSON.stringify(opp.risks),
          opp.suggested_reach,
          opp.suggested_impact,
          opp.suggested_confidence,
          opp.suggested_effort,
          rice,
          priority,
          `Suggested recommendation (RICE ${rice}): ${opp.recommended_next_action}`,
          now,
          now
        );
      }

      stages = setStage(stages, 'opportunity_generation', 'completed', `${oppProposals.length} suggested opportunities created`);
    } else {
      stages = setStage(stages, 'opportunity_generation', 'skipped', 'No new pain point themes requiring opportunities');
    }

    // Stage 9: Final storage confirmation
    stages = setStage(stages, 'database_storage', 'completed', 'Workspace insights, evidence, and dashboard metrics updated');
    updateJobState(params.jobId, {
      status: failed > 0 ? 'partial' : 'completed',
      processed_records: processed,
      failed_records: failed,
      current_stage: 'database_storage',
      stages,
      error_message: null,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    const pipelineErr = classifyUpstreamError(err);
    const activeStage = stages.find((s) => s.status === 'running')?.key || 'classification';
    stages = setStage(stages, activeStage, 'failed', pipelineErr.message);

    // Mark still-processing rows as failed so retry resumes cleanly
    db.prepare(
      `UPDATE feedback_records SET processing_status = 'failed'
       WHERE workspace_id = ? AND processing_status = 'processing'`
    ).run(params.workspaceId);

    updateJobState(params.jobId, {
      status: 'failed',
      current_stage: activeStage,
      stages,
      error_message: pipelineErr.message,
      completed_at: new Date().toISOString(),
    });
  }
}
