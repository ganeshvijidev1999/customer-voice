import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'voc-copilot.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Optional Supabase client when user provides their existing credentials in server environment
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    !supabaseUrl.includes('your-project-ref') &&
    (supabaseServiceKey || supabaseAnonKey) &&
    !supabaseServiceKey.includes('your-supabase')
);

let cachedSupabaseAdmin: SupabaseClient | null = null;
async function getSupabaseAdmin(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured) return null;
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;
  const { createClient } = await import('@supabase/supabase-js');
  cachedSupabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedSupabaseAdmin;
}

export function initSchema(): void {
  db.exec(`
    -- 1. profiles
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      role_title TEXT,
      created_at TEXT NOT NULL
    );

    -- sessions (Bearer token auth)
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 2. workspaces
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT 'SaaS',
      business_type TEXT NOT NULL DEFAULT 'B2B',
      user_role TEXT NOT NULL DEFAULT 'Product Manager',
      primary_objective TEXT NOT NULL DEFAULT 'Improve customer retention',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    -- 3. workspace_members
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      invited_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, email)
    );

    -- 5. pain_point_themes
    CREATE TABLE IF NOT EXISTS pain_point_themes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      why_happening TEXT NOT NULL DEFAULT '',
      next_investigation TEXT NOT NULL DEFAULT '',
      frequency INTEGER NOT NULL DEFAULT 0,
      severity TEXT NOT NULL DEFAULT 'Medium',
      severity_reasoning TEXT NOT NULL DEFAULT '',
      sentiment TEXT NOT NULL DEFAULT 'Negative',
      affected_segments TEXT NOT NULL DEFAULT '[]',
      first_reported_date TEXT,
      latest_reported_date TEXT,
      trend_summary TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.75,
      evidence_strength TEXT NOT NULL DEFAULT 'Insufficient',
      review_status TEXT NOT NULL DEFAULT 'Needs Review',
      human_corrected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 4. feedback_records
    CREATE TABLE IF NOT EXISTS feedback_records (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      feedback_id TEXT NOT NULL,
      customer_text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Manual Entry',
      customer_segment TEXT NOT NULL DEFAULT 'General',
      customer_id TEXT,
      product_area TEXT NOT NULL DEFAULT 'General',
      feedback_date TEXT NOT NULL,
      sentiment TEXT,
      sentiment_reasoning TEXT,
      category TEXT,
      customer_intent TEXT,
      main_issue TEXT,
      problem_description TEXT,
      severity TEXT,
      severity_reasoning TEXT,
      classification_confidence REAL,
      churn_signal INTEGER NOT NULL DEFAULT 0,
      churn_signal_type TEXT,
      churn_concern_level TEXT,
      churn_reasoning TEXT,
      churn_followup TEXT,
      churn_status TEXT NOT NULL DEFAULT 'Open',
      theme_id TEXT REFERENCES pain_point_themes(id) ON DELETE SET NULL,
      processing_status TEXT NOT NULL DEFAULT 'pending',
      human_corrected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, feedback_id)
    );

    -- 6. evidence_records
    CREATE TABLE IF NOT EXISTS evidence_records (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      feedback_record_id TEXT NOT NULL REFERENCES feedback_records(id) ON DELETE CASCADE,
      theme_id TEXT NOT NULL REFERENCES pain_point_themes(id) ON DELETE CASCADE,
      original_quote TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.85,
      created_at TEXT NOT NULL,
      UNIQUE(feedback_record_id, theme_id)
    );

    -- 7. analysis_jobs
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      total_records INTEGER NOT NULL DEFAULT 0,
      processed_records INTEGER NOT NULL DEFAULT 0,
      failed_records INTEGER NOT NULL DEFAULT 0,
      current_stage TEXT NOT NULL DEFAULT 'validation',
      stages_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      batch_size INTEGER NOT NULL DEFAULT 10,
      created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    -- 8. opportunities
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      theme_id TEXT REFERENCES pain_point_themes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      problem_statement TEXT NOT NULL,
      customer_impact TEXT NOT NULL DEFAULT '',
      business_impact TEXT NOT NULL DEFAULT '',
      proposed_solution TEXT NOT NULL DEFAULT '',
      recommended_next_action TEXT NOT NULL DEFAULT '',
      assumptions TEXT NOT NULL DEFAULT '[]',
      risks TEXT NOT NULL DEFAULT '[]',
      reach INTEGER NOT NULL DEFAULT 100,
      impact REAL NOT NULL DEFAULT 1.0,
      confidence INTEGER NOT NULL DEFAULT 70,
      effort REAL NOT NULL DEFAULT 2.0,
      rice_score REAL NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'P2 - Medium',
      recommendation TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 9. action_plans
    CREATE TABLE IF NOT EXISTS action_plans (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      problem_statement TEXT NOT NULL DEFAULT '',
      evidence_summary TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      expected_impact TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT 'Product Manager',
      priority TEXT NOT NULL DEFAULT 'P1 - High',
      status TEXT NOT NULL DEFAULT 'Not started',
      next_steps TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 10. ai_processing_logs
    CREATE TABLE IF NOT EXISTS ai_processing_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES analysis_jobs(id) ON DELETE SET NULL,
      workflow_name TEXT NOT NULL,
      model_name TEXT NOT NULL,
      records_count INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    -- Cost-optimisation result cache keyed by text_hash + workflow_name
    CREATE TABLE IF NOT EXISTS ai_cache (
      cache_key TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      result_json TEXT NOT NULL,
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- AI Evaluation Runs (Section 15)
    CREATE TABLE IF NOT EXISTS evaluation_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      dataset_size INTEGER NOT NULL,
      classification_precision REAL NOT NULL,
      classification_recall REAL NOT NULL,
      sentiment_agreement REAL NOT NULL,
      theme_grouping_quality REAL NOT NULL,
      evidence_traceability REAL NOT NULL,
      invalid_ai_responses INTEGER NOT NULL,
      human_correction_rate REAL NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Indexes matching PostgreSQL schema
    CREATE INDEX IF NOT EXISTS idx_ws_members ON workspace_members(workspace_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_fb_ws_date ON feedback_records(workspace_id, feedback_date DESC);
    CREATE INDEX IF NOT EXISTS idx_fb_ws_hash ON feedback_records(workspace_id, text_hash);
    CREATE INDEX IF NOT EXISTS idx_fb_ws_theme ON feedback_records(workspace_id, theme_id);
    CREATE INDEX IF NOT EXISTS idx_fb_ws_status ON feedback_records(workspace_id, processing_status);
    CREATE INDEX IF NOT EXISTS idx_themes_ws ON pain_point_themes(workspace_id, frequency DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_ws_theme ON evidence_records(workspace_id, theme_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_ws ON analysis_jobs(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opp_ws ON opportunities(workspace_id, rice_score DESC);
    CREATE INDEX IF NOT EXISTS idx_act_ws ON action_plans(workspace_id, status);
    CREATE INDEX IF NOT EXISTS idx_logs_ws ON ai_processing_logs(workspace_id, created_at DESC);
  `);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

export function hashFeedbackText(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function computeRiceScore(reach: number, impact: number, confidence: number, effort: number): number {
  const safeEffort = Math.max(0.5, Number(effort) || 1);
  const confRatio = confidence > 1 ? confidence / 100 : confidence;
  return Number(((reach * impact * confRatio) / safeEffort).toFixed(1));
}

export function derivePriorityFromRice(rice: number): 'P0 - Critical' | 'P1 - High' | 'P2 - Medium' | 'P3 - Low' {
  if (rice >= 250) return 'P0 - Critical';
  if (rice >= 120) return 'P1 - High';
  if (rice >= 50) return 'P2 - Medium';
  return 'P3 - Low';
}

export function computeEvidenceStrength(
  count: number,
  distinctSegments: number,
  distinctDates: number
): 'Strong' | 'Moderate' | 'Insufficient' {
  if (count >= 5 && (distinctSegments >= 2 || distinctDates >= 2)) return 'Strong';
  if (count >= 2) return 'Moderate';
  return 'Insufficient';
}

/**
 * Optional non-blocking sync mirror to user's Supabase project when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided.
 */
export async function syncRecordToSupabase(table: string, payload: Record<string, unknown>): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) return;
  try {
    await client.from(table).upsert(payload);
  } catch {
    // Non-blocking mirror: local SQLite remains authoritative if remote table is not migrated yet
  }
}
