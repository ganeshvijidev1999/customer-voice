import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction, type Express } from 'express';
import { z } from 'zod';
import {
  db,
  initSchema,
  isSupabaseConfigured,
  generateId,
  hashPassword,
  verifyPassword,
  hashFeedbackText,
  computeRiceScore,
  derivePriorityFromRice,
  computeEvidenceStrength,
} from './db.ts';
import {
  computeDashboardMetrics,
  getWorkspaceThemesWithEvidence,
  getWorkspaceOpportunities,
  getWorkspaceActionPlans,
} from './analytics.ts';
import {
  GOLDEN_EVALUATION_DATASET,
  PROPOSED_EVALUATION_TARGETS,
  getWorkspaceEvidenceTraceability,
  getWorkspaceHumanCorrectionRate,
  getWorkspaceInvalidResponsesCount,
  runLiveGoldenEvaluation,
} from './evaluation.ts';
import type {
  Profile,
  Workspace,
  WorkspaceRole,
  CsvImportSummary,
  RuntimeStatus,
  PipelineStage,
} from '../shared/types.ts';

const GEMINI_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';
const FREE_TIER_HOURLY_LIMIT = 60;

function isGeminiConfigured(): boolean {
  const orKey = process.env.OPENROUTER_API_KEY?.trim() || '';
  if (orKey && !orKey.includes('your-openrouter') && orKey.length > 10) return true;
  const legacyKey = process.env.GEMINI_API_KEY?.trim() || '';
  return Boolean(legacyKey.startsWith('sk-or-') && legacyKey.length > 10);
}

function createInitialStages(): PipelineStage[] {
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

let schemaInitialized = false;
function ensureSchema(): void {
  if (schemaInitialized) return;
  initSchema();
  schemaInitialized = true;
}

let cachedDemoSeed: { demoUserId: string; demoWorkspaceId: string } | null = null;
export async function getDemoSeed(): Promise<{ demoUserId: string; demoWorkspaceId: string }> {
  ensureSchema();
  if (cachedDemoSeed) return cachedDemoSeed;
  const existingUser = db
    .prepare('SELECT id FROM profiles WHERE email = ?')
    .get('alex.morgan@acmetech.io') as { id: string } | undefined;
  if (existingUser) {
    const existingWs = db
      .prepare('SELECT id FROM workspaces WHERE created_by = ? AND is_demo = 1 LIMIT 1')
      .get(existingUser.id) as { id: string } | undefined;
    if (existingWs) {
      cachedDemoSeed = { demoUserId: existingUser.id, demoWorkspaceId: existingWs.id };
      return cachedDemoSeed;
    }
  }
  const { seedDemoWorkspaceIfNeeded } = await import('./seedDemoData.ts');
  cachedDemoSeed = seedDemoWorkspaceIfNeeded();
  return cachedDemoSeed;
}

interface AuthedRequest extends Request {
  user?: Profile;
  workspace?: Workspace;
  memberRole?: WorkspaceRole;
}

function getProfileById(id: string): Profile | null {
  const row = db
    .prepare('SELECT id, email, full_name, avatar_url, role_title, created_at FROM profiles WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: String(row.full_name),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    role_title: row.role_title ? String(row.role_title) : null,
    created_at: String(row.created_at),
  };
}

function createSession(userId: string): string {
  const token = generateId() + '-' + generateId();
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    expires,
    now.toISOString()
  );
  return token;
}

function getUserWorkspaces(userId: string): Workspace[] {
  const rows = db
    .prepare(
      `SELECT w.*, wm.role as member_role,
              (SELECT COUNT(*) FROM feedback_records f WHERE f.workspace_id = w.id) as feedback_count,
              (SELECT COUNT(*) FROM feedback_records f WHERE f.workspace_id = w.id AND f.processing_status = 'completed') as analyzed_count
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ? AND wm.status = 'active'
       ORDER BY w.is_demo ASC, w.created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    company_name: String(r.company_name),
    industry: String(r.industry),
    business_type: String(r.business_type),
    user_role: String(r.user_role),
    primary_objective: String(r.primary_objective),
    is_demo: Boolean(r.is_demo),
    created_by: String(r.created_by),
    created_at: String(r.created_at),
    member_role: String(r.member_role) as WorkspaceRole,
    feedback_count: Number(r.feedback_count || 0),
    analyzed_count: Number(r.analyzed_count || 0),
  }));
}

function getRuntimeStatus(workspaceId?: string): RuntimeStatus {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const hourly = workspaceId
    ? ((db
        .prepare(
          `SELECT COUNT(*) as cnt FROM ai_processing_logs
           WHERE workspace_id = ? AND created_at >= ? AND cache_hit = 0 AND model_name = ?`
        )
        .get(workspaceId, oneHourAgo, GEMINI_MODEL) as { cnt: number })?.cnt || 0)
    : 0;

  const totals = workspaceId
    ? (db
        .prepare(
          `SELECT
             COALESCE(SUM(prompt_tokens + output_tokens), 0) as tokens,
             COALESCE(SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END), 0) as hits,
             COUNT(*) as calls
           FROM ai_processing_logs WHERE workspace_id = ?`
        )
        .get(workspaceId) as { tokens: number; hits: number; calls: number })
    : { tokens: 0, hits: 0, calls: 0 };

  return {
    database_mode: isSupabaseConfigured ? 'supabase_postgresql' : 'local_sqlite_mirror',
    supabase_configured: isSupabaseConfigured,
    gemini_configured: isGeminiConfigured(),
    gemini_model: GEMINI_MODEL,
    free_tier_hourly_limit: FREE_TIER_HOURLY_LIMIT,
    workspace_requests_last_hour: hourly,
    total_tokens_used: totals?.tokens || 0,
    cache_hits: totals?.hits || 0,
    total_ai_calls: totals?.calls || 0,
  };
}

function recalculateThemeMetadata(workspaceId: string, themeId: string): void {
  const evRows = db
    .prepare(
      `SELECT f.customer_segment, f.feedback_date
       FROM evidence_records e
       JOIN feedback_records f ON f.id = e.feedback_record_id
       WHERE e.workspace_id = ? AND e.theme_id = ?`
    )
    .all(workspaceId, themeId) as Array<{ customer_segment: string; feedback_date: string }>;

  const segments = Array.from(new Set(evRows.map((r) => r.customer_segment)));
  const dates = evRows.map((r) => r.feedback_date).filter(Boolean).sort();
  const strength = computeEvidenceStrength(evRows.length, segments.length, new Set(dates).size);

  db.prepare(
    `UPDATE pain_point_themes
     SET frequency = ?, affected_segments = ?, first_reported_date = ?, latest_reported_date = ?,
         evidence_strength = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`
  ).run(
    evRows.length,
    JSON.stringify(segments),
    dates[0] || null,
    dates[dates.length - 1] || null,
    strength,
    new Date().toISOString(),
    themeId,
    workspaceId
  );
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const sess = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: string; expires_at: string } | undefined;

  if (!sess || new Date(sess.expires_at).getTime() < Date.now()) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  const user = getProfileById(sess.user_id);
  if (!user) {
    res.status(401).json({ error: 'User profile not found.' });
    return;
  }

  req.user = user;
  next();
}

function requireWorkspaceAccess(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const workspaceId = String(req.params.workspaceId || '');
  const row = db
    .prepare(
      `SELECT w.*, wm.role as member_role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE w.id = ? AND wm.user_id = ? AND wm.status = 'active'`
    )
    .get(workspaceId, req.user.id) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(403).json({ error: 'Access denied: you do not have permission to access this workspace.' });
    return;
  }

  req.workspace = {
    id: String(row.id),
    name: String(row.name),
    company_name: String(row.company_name),
    industry: String(row.industry),
    business_type: String(row.business_type),
    user_role: String(row.user_role),
    primary_objective: String(row.primary_objective),
    is_demo: Boolean(row.is_demo),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    member_role: String(row.member_role) as WorkspaceRole,
  };
  req.memberRole = req.workspace.member_role;
  next();
}

function validateAndNormalizeDate(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return new Date().toISOString().slice(0, 10);
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function createApiApp(): Express {
  ensureSchema();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // ============================================================================
  // AUTHENTICATION ENDPOINTS
  // ============================================================================
  app.post('/api/auth/register', (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      full_name: z.string().min(2).max(100),
      role_title: z.string().max(100).optional(),
      workspace: z
        .object({
          company_name: z.string().min(2).max(120),
          industry: z.string().min(2).max(80),
          business_type: z.string().min(2).max(80),
          user_role: z.string().min(2).max(80),
          primary_objective: z.string().min(2).max(160),
        })
        .optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const userId = generateId();
    db.prepare(
      `INSERT INTO profiles (id, email, full_name, password_hash, avatar_url, role_title, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      userId,
      email,
      parsed.data.full_name.trim(),
      hashPassword(parsed.data.password),
      parsed.data.role_title?.trim() || parsed.data.workspace?.user_role || 'Product Manager',
      now
    );

    db.prepare(`UPDATE workspace_members SET user_id = ?, status = 'active' WHERE LOWER(email) = ?`).run(
      userId,
      email
    );

    let createdWorkspaceId: string | null = null;
    if (parsed.data.workspace) {
      const ws = parsed.data.workspace;
      createdWorkspaceId = generateId();
      db.prepare(
        `INSERT INTO workspaces (id, name, company_name, industry, business_type, user_role, primary_objective, is_demo, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        createdWorkspaceId,
        ws.company_name.trim(),
        ws.company_name.trim(),
        ws.industry.trim(),
        ws.business_type.trim(),
        ws.user_role.trim(),
        ws.primary_objective.trim(),
        userId,
        now
      );

      db.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, email, role, status, invited_by, created_at)
         VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)`
      ).run(generateId(), createdWorkspaceId, userId, email, userId, now);
    }

    const token = createSession(userId);
    const user = getProfileById(userId);
    const workspaces = getUserWorkspaces(userId);

    res.status(201).json({
      token,
      user,
      workspaces,
      active_workspace_id: createdWorkspaceId || workspaces[0]?.id || null,
      runtime: getRuntimeStatus(createdWorkspaceId || workspaces[0]?.id),
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide a valid email and password.' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const row = db
      .prepare('SELECT id, password_hash FROM profiles WHERE email = ?')
      .get(email) as { id: string; password_hash: string } | undefined;

    if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = createSession(row.id);
    const user = getProfileById(row.id);
    const workspaces = getUserWorkspaces(row.id);

    res.json({
      token,
      user,
      workspaces,
      active_workspace_id: workspaces[0]?.id || null,
      runtime: getRuntimeStatus(workspaces[0]?.id),
    });
  });

  app.post('/api/auth/demo-session', async (_req, res) => {
    const demoSeed = await getDemoSeed();
    const token = createSession(demoSeed.demoUserId);
    const user = getProfileById(demoSeed.demoUserId);
    const workspaces = getUserWorkspaces(demoSeed.demoUserId);
    res.json({
      token,
      user,
      workspaces,
      active_workspace_id: demoSeed.demoWorkspaceId,
      runtime: getRuntimeStatus(demoSeed.demoWorkspaceId),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const workspaces = getUserWorkspaces(req.user!.id);
    const activeWsId = String(req.query.workspaceId || workspaces[0]?.id || '');
    res.json({
      user: req.user,
      workspaces,
      runtime: getRuntimeStatus(activeWsId || undefined),
    });
  });

  // ============================================================================
  // WORKSPACES & MEMBERS
  // ============================================================================
  app.get('/api/workspaces', requireAuth, (req: AuthedRequest, res) => {
    res.json({ workspaces: getUserWorkspaces(req.user!.id) });
  });

  app.post('/api/workspaces', requireAuth, (req: AuthedRequest, res) => {
    const schema = z.object({
      company_name: z.string().min(2).max(120),
      name: z.string().min(2).max(120).optional(),
      industry: z.string().min(2).max(80),
      business_type: z.string().min(2).max(80),
      user_role: z.string().min(2).max(80),
      primary_objective: z.string().min(2).max(160),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid workspace fields.' });
      return;
    }

    const now = new Date().toISOString();
    const wsId = generateId();
    const d = parsed.data;
    db.prepare(
      `INSERT INTO workspaces (id, name, company_name, industry, business_type, user_role, primary_objective, is_demo, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      wsId,
      (d.name || d.company_name).trim(),
      d.company_name.trim(),
      d.industry.trim(),
      d.business_type.trim(),
      d.user_role.trim(),
      d.primary_objective.trim(),
      req.user!.id,
      now
    );

    db.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, email, role, status, invited_by, created_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)`
    ).run(generateId(), wsId, req.user!.id, req.user!.email, req.user!.id, now);

    const workspaces = getUserWorkspaces(req.user!.id);
    const created = workspaces.find((w) => w.id === wsId);
    res.status(201).json({ workspace: created, workspaces });
  });

  app.patch('/api/workspaces/:workspaceId', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const schema = z.object({
      name: z.string().min(2).max(120).optional(),
      company_name: z.string().min(2).max(120).optional(),
      industry: z.string().min(2).max(80).optional(),
      business_type: z.string().min(2).max(80).optional(),
      user_role: z.string().min(2).max(80).optional(),
      primary_objective: z.string().min(2).max(160).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid workspace update fields.' });
      return;
    }

    const ws = req.workspace!;
    const d = parsed.data;
    db.prepare(
      `UPDATE workspaces
       SET name = ?, company_name = ?, industry = ?, business_type = ?, user_role = ?, primary_objective = ?
       WHERE id = ?`
    ).run(
      d.name?.trim() || ws.name,
      d.company_name?.trim() || ws.company_name,
      d.industry?.trim() || ws.industry,
      d.business_type?.trim() || ws.business_type,
      d.user_role?.trim() || ws.user_role,
      d.primary_objective?.trim() || ws.primary_objective,
      ws.id
    );

    const workspaces = getUserWorkspaces(req.user!.id);
    res.json({ workspace: workspaces.find((w) => w.id === ws.id), workspaces });
  });

  app.get('/api/workspaces/:workspaceId/members', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT wm.*, p.full_name
         FROM workspace_members wm
         LEFT JOIN profiles p ON p.id = wm.user_id
         WHERE wm.workspace_id = ?
         ORDER BY CASE wm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'member' THEN 3 ELSE 4 END, wm.created_at ASC`
      )
      .all(req.workspace!.id);
    res.json({ members: rows });
  });

  app.post('/api/workspaces/:workspaceId/members', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member', 'viewer']).default('member'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide a valid teammate email and role.' });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const existing = db
      .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND LOWER(email) = ?')
      .get(req.workspace!.id, email);
    if (existing) {
      res.status(409).json({ error: 'This email is already a member or invited to this workspace.' });
      return;
    }

    const profile = db.prepare('SELECT id FROM profiles WHERE LOWER(email) = ?').get(email) as { id: string } | undefined;
    const now = new Date().toISOString();
    const memberId = generateId();
    db.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, email, role, status, invited_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      memberId,
      req.workspace!.id,
      profile?.id || null,
      email,
      parsed.data.role,
      profile ? 'active' : 'invited',
      req.user!.id,
      now
    );

    const members = db
      .prepare(
        `SELECT wm.*, p.full_name FROM workspace_members wm LEFT JOIN profiles p ON p.id = wm.user_id WHERE wm.workspace_id = ?`
      )
      .all(req.workspace!.id);
    res.status(201).json({ members });
  });

  app.delete(
    '/api/workspaces/:workspaceId/members/:memberId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const target = db
        .prepare('SELECT role FROM workspace_members WHERE id = ? AND workspace_id = ?')
        .get(req.params.memberId, req.workspace!.id) as { role: string } | undefined;
      if (!target) {
        res.status(404).json({ error: 'Member not found.' });
        return;
      }
      if (target.role === 'owner') {
        res.status(400).json({ error: 'Cannot remove the workspace owner.' });
        return;
      }
      db.prepare('DELETE FROM workspace_members WHERE id = ? AND workspace_id = ?').run(
        req.params.memberId,
        req.workspace!.id
      );
      res.json({ ok: true });
    }
  );

  // ============================================================================
  // DASHBOARD, SEARCH & NOTIFICATIONS
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/dashboard', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const metrics = computeDashboardMetrics(req.workspace!);
    res.json({
      metrics,
      runtime: getRuntimeStatus(req.workspace!.id),
    });
  });

  app.get('/api/workspaces/:workspaceId/search', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) {
      res.json({ feedback: [], themes: [], opportunities: [], action_plans: [] });
      return;
    }
    const like = `%${q}%`;
    const wsId = req.workspace!.id;

    const feedback = db
      .prepare(
        `SELECT id, feedback_id, customer_text, source, customer_segment, feedback_date, sentiment, severity
         FROM feedback_records
         WHERE workspace_id = ? AND (LOWER(customer_text) LIKE ? OR LOWER(feedback_id) LIKE ? OR LOWER(COALESCE(customer_id,'')) LIKE ? OR LOWER(product_area) LIKE ?)
         ORDER BY feedback_date DESC LIMIT 8`
      )
      .all(wsId, like, like, like, like);

    const themes = db
      .prepare(
        `SELECT id, title, severity, frequency, evidence_strength
         FROM pain_point_themes
         WHERE workspace_id = ? AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?)
         ORDER BY frequency DESC LIMIT 6`
      )
      .all(wsId, like, like);

    const opportunities = db
      .prepare(
        `SELECT id, title, rice_score, priority, status
         FROM opportunities
         WHERE workspace_id = ? AND (LOWER(title) LIKE ? OR LOWER(problem_statement) LIKE ?)
         ORDER BY rice_score DESC LIMIT 6`
      )
      .all(wsId, like, like);

    const action_plans = db
      .prepare(
        `SELECT id, title, owner, status, priority
         FROM action_plans
         WHERE workspace_id = ? AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?)
         ORDER BY created_at DESC LIMIT 6`
      )
      .all(wsId, like, like);

    res.json({ feedback, themes, opportunities, action_plans });
  });

  app.get(
    '/api/workspaces/:workspaceId/notifications',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const wsId = req.workspace!.id;
      const notifications: Array<{
        id: string;
        type: 'job_failed' | 'job_completed' | 'needs_review' | 'churn_signal' | 'pending_records';
        title: string;
        detail: string;
        target_tab: string;
        timestamp: string;
      }> = [];

      const recentJobs = db
        .prepare('SELECT id, status, processed_records, error_message, created_at FROM analysis_jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 3')
        .all(wsId) as Array<Record<string, unknown>>;

      for (const j of recentJobs) {
        if (j.status === 'failed') {
          notifications.push({
            id: `job-${j.id}`,
            type: 'job_failed',
            title: 'AI Analysis Job Failed',
            detail: String(j.error_message || 'Pipeline paused with an error. You can restart from Feedback Inbox.'),
            target_tab: 'inbox',
            timestamp: String(j.created_at),
          });
        } else if (j.status === 'completed') {
          notifications.push({
            id: `job-${j.id}`,
            type: 'job_completed',
            title: 'Analysis Pipeline Completed',
            detail: `${j.processed_records} feedback records analyzed with evidence-backed themes.`,
            target_tab: 'inbox',
            timestamp: String(j.created_at),
          });
        }
      }

      const unreviewedHigh = db
        .prepare(
          `SELECT id, title, frequency, updated_at FROM pain_point_themes
           WHERE workspace_id = ? AND severity = 'High' AND review_status = 'Needs Review' LIMIT 3`
        )
        .all(wsId) as Array<Record<string, unknown>>;
      for (const t of unreviewedHigh) {
        notifications.push({
          id: `theme-${t.id}`,
          type: 'needs_review',
          title: `High-severity theme awaits PM review`,
          detail: `${t.title} (${t.frequency} linked quotes).`,
          target_tab: 'explorer',
          timestamp: String(t.updated_at),
        });
      }

      const openHighChurn = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM feedback_records
           WHERE workspace_id = ? AND churn_signal = 1 AND churn_concern_level = 'High' AND churn_status = 'Open'`
        )
        .get(wsId) as { cnt: number };
      if ((openHighChurn?.cnt || 0) > 0) {
        notifications.push({
          id: 'churn-open-high',
          type: 'churn_signal',
          title: `${openHighChurn.cnt} High-concern potential churn signals open`,
          detail: 'Review supporting quotes and suggested follow-up actions in Churn Signals.',
          target_tab: 'churn',
          timestamp: new Date().toISOString(),
        });
      }

      const pendingCount = (
        db
          .prepare(`SELECT COUNT(*) as cnt FROM feedback_records WHERE workspace_id = ? AND processing_status = 'pending'`)
          .get(wsId) as { cnt: number }
      )?.cnt;
      if (pendingCount > 0) {
        notifications.push({
          id: 'pending-fb',
          type: 'pending_records',
          title: `${pendingCount} unprocessed feedback records waiting`,
          detail: 'Run the OpenRouter AI pipeline from Feedback Inbox to classify and map evidence.',
          target_tab: 'inbox',
          timestamp: new Date().toISOString(),
        });
      }

      res.json({ notifications });
    }
  );

  // ============================================================================
  // FEEDBACK INBOX & INGESTION (CSV / MANUAL / BULK PASTE)
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/feedback', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const wsId = req.workspace!.id;
    const search = String(req.query.search || '').trim().toLowerCase();
    const sentiment = String(req.query.sentiment || '');
    const severity = String(req.query.severity || '');
    const source = String(req.query.source || '');
    const segment = String(req.query.segment || '');
    const productArea = String(req.query.product_area || '');
    const status = String(req.query.status || '');
    const churnOnly = req.query.churn_only === 'true';

    const clauses = ['f.workspace_id = ?'];
    const params: Array<string | number> = [wsId];

    if (search) {
      clauses.push(
        `(LOWER(f.customer_text) LIKE ? OR LOWER(f.feedback_id) LIKE ? OR LOWER(COALESCE(f.customer_id,'')) LIKE ? OR LOWER(COALESCE(f.main_issue,'')) LIKE ?)`
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (sentiment && sentiment !== 'All') {
      clauses.push('f.sentiment = ?');
      params.push(sentiment);
    }
    if (severity && severity !== 'All') {
      clauses.push('f.severity = ?');
      params.push(severity);
    }
    if (source && source !== 'All') {
      clauses.push('f.source = ?');
      params.push(source);
    }
    if (segment && segment !== 'All') {
      clauses.push('f.customer_segment = ?');
      params.push(segment);
    }
    if (productArea && productArea !== 'All') {
      clauses.push('f.product_area = ?');
      params.push(productArea);
    }
    if (status && status !== 'All') {
      clauses.push('f.processing_status = ?');
      params.push(status);
    }
    if (churnOnly) {
      clauses.push('f.churn_signal = 1');
    }

    const rows = db
      .prepare(
        `SELECT f.*, t.title as theme_title
         FROM feedback_records f
         LEFT JOIN pain_point_themes t ON t.id = f.theme_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY f.feedback_date DESC, f.created_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    const records = rows.map((r) => ({
      ...r,
      churn_signal: Boolean(r.churn_signal),
      human_corrected: Boolean(r.human_corrected),
    }));

    res.json({ records, total: records.length });
  });

  app.post('/api/workspaces/:workspaceId/feedback/bulk', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const rowSchema = z.object({
      feedback_id: z.string().optional().nullable(),
      customer_text: z.string().optional().nullable(),
      source: z.string().optional().nullable(),
      feedback_date: z.string().optional().nullable(),
      customer_segment: z.string().optional().nullable(),
      customer_id: z.string().optional().nullable(),
      product_area: z.string().optional().nullable(),
    });
    const bodySchema = z.object({
      records: z.array(rowSchema).min(1, 'At least one feedback record is required.').max(2000, 'Maximum 2,000 rows per upload batch.'),
      default_source: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid feedback payload.' });
      return;
    }

    const wsId = req.workspace!.id;
    const existingFeedbackIds = new Set(
      (
        db.prepare('SELECT feedback_id FROM feedback_records WHERE workspace_id = ?').all(wsId) as Array<{
          feedback_id: string;
        }>
      ).map((r) => r.feedback_id.toLowerCase())
    );
    const existingHashes = new Set(
      (
        db.prepare('SELECT text_hash FROM feedback_records WHERE workspace_id = ?').all(wsId) as Array<{
          text_hash: string;
        }>
      ).map((r) => r.text_hash)
    );

    const seenBatchIds = new Set<string>();
    const seenBatchHashes = new Set<string>();

    const summary: CsvImportSummary = {
      total_records: parsed.data.records.length,
      valid_records: 0,
      duplicate_records: 0,
      invalid_records: 0,
      saved_ids: [],
      duplicates: [],
      invalids: [],
      import_status: 'completed',
    };

    const now = new Date().toISOString();
    const insertStmt = db.prepare(
      `INSERT INTO feedback_records (
        id, workspace_id, feedback_id, customer_text, text_hash, source,
        customer_segment, customer_id, product_area, feedback_date,
        processing_status, churn_signal, churn_status, human_corrected, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 'Open', 0, ?)`
    );

    const existingCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM feedback_records WHERE workspace_id = ?').get(wsId) as { cnt: number }
    ).cnt;
    let seqCounter = existingCount + 1;

    for (let idx = 0; idx < parsed.data.records.length; idx++) {
      const raw = parsed.data.records[idx];
      const rowIndex = idx + 1;
      const text = (raw.customer_text || '').trim();
      const fid = (raw.feedback_id || '').trim() || `FB-${String(2000 + seqCounter++).padStart(4, '0')}`;

      if (!text) {
        summary.invalid_records++;
        summary.invalids.push({
          row_index: rowIndex,
          feedback_id: fid,
          reason: 'Customer feedback text is empty.',
          preview: '(empty)',
        });
        continue;
      }
      if (text.length < 5) {
        summary.invalid_records++;
        summary.invalids.push({
          row_index: rowIndex,
          feedback_id: fid,
          reason: 'Customer feedback text is too short (< 5 characters).',
          preview: text,
        });
        continue;
      }
      if (text.length > 5000) {
        summary.invalid_records++;
        summary.invalids.push({
          row_index: rowIndex,
          feedback_id: fid,
          reason: 'Customer feedback text exceeds 5,000 character safety limit.',
          preview: text.slice(0, 80) + '...',
        });
        continue;
      }

      const normalizedDate = validateAndNormalizeDate(raw.feedback_date);
      if (!normalizedDate) {
        summary.invalid_records++;
        summary.invalids.push({
          row_index: rowIndex,
          feedback_id: fid,
          reason: `Invalid date format "${raw.feedback_date}". Expected YYYY-MM-DD or ISO date.`,
          preview: text.slice(0, 80),
        });
        continue;
      }

      const textHash = hashFeedbackText(text);
      const fidLower = fid.toLowerCase();

      if (existingFeedbackIds.has(fidLower) || seenBatchIds.has(fidLower)) {
        summary.duplicate_records++;
        summary.duplicates.push({
          row_index: rowIndex,
          feedback_id: fid,
          reason: `Duplicate Feedback ID "${fid}" already exists.`,
          preview: text.slice(0, 80),
        });
        continue;
      }
      if (existingHashes.has(textHash) || seenBatchHashes.has(textHash)) {
        summary.duplicate_records++;
        summary.duplicates.push({
          row_index: rowIndex,
          feedback_id: fid,
          reason: 'Identical customer feedback text already exists in workspace.',
          preview: text.slice(0, 80),
        });
        continue;
      }

      const id = generateId();
      insertStmt.run(
        id,
        wsId,
        fid,
        text,
        textHash,
        (raw.source || parsed.data.default_source || 'CSV Upload').trim(),
        (raw.customer_segment || 'General').trim(),
        raw.customer_id?.trim() || null,
        (raw.product_area || 'General').trim(),
        normalizedDate,
        now
      );

      seenBatchIds.add(fidLower);
      seenBatchHashes.add(textHash);
      existingFeedbackIds.add(fidLower);
      existingHashes.add(textHash);
      summary.valid_records++;
      summary.saved_ids.push(id);
    }

    if (summary.valid_records === 0) {
      summary.import_status = 'rejected';
    } else if (summary.duplicate_records > 0 || summary.invalid_records > 0) {
      summary.import_status = 'partial';
    } else {
      summary.import_status = 'completed';
    }

    res.status(201).json({ summary });
  });

  app.patch(
    '/api/workspaces/:workspaceId/feedback/:recordId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        sentiment: z.enum(['Positive', 'Negative', 'Neutral', 'Mixed', 'Uncertain']).optional(),
        severity: z.enum(['Low', 'Medium', 'High']).optional(),
        category: z.string().max(120).optional(),
        product_area: z.string().max(120).optional(),
        churn_signal: z.boolean().optional(),
        churn_status: z.enum(['Open', 'Investigating', 'Addressed']).optional(),
        churn_followup: z.string().max(500).optional(),
        theme_id: z.string().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid feedback update payload.' });
        return;
      }

      const wsId = req.workspace!.id;
      const existing = db
        .prepare('SELECT * FROM feedback_records WHERE id = ? AND workspace_id = ?')
        .get(req.params.recordId, wsId) as Record<string, SQLInputValue> | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Feedback record not found.' });
        return;
      }

      const d = parsed.data;
      const nextThemeId = d.theme_id !== undefined ? d.theme_id : (existing.theme_id as string | null);

      db.prepare(
        `UPDATE feedback_records
         SET sentiment = ?, severity = ?, category = ?, product_area = ?,
             churn_signal = ?, churn_status = ?, churn_followup = ?, theme_id = ?, human_corrected = 1
         WHERE id = ? AND workspace_id = ?`
      ).run(
        d.sentiment ?? existing.sentiment,
        d.severity ?? existing.severity,
        d.category ?? existing.category,
        d.product_area ?? existing.product_area,
        d.churn_signal !== undefined ? (d.churn_signal ? 1 : 0) : existing.churn_signal,
        d.churn_status ?? existing.churn_status,
        d.churn_followup ?? existing.churn_followup,
        nextThemeId,
        req.params.recordId,
        wsId
      );

      if (d.theme_id !== undefined && d.theme_id !== existing.theme_id) {
        const oldThemeId = existing.theme_id as string | null;
        db.prepare('DELETE FROM evidence_records WHERE feedback_record_id = ? AND workspace_id = ?').run(
          req.params.recordId,
          wsId
        );
        if (nextThemeId) {
          db.prepare(
            `INSERT OR IGNORE INTO evidence_records (id, workspace_id, feedback_record_id, theme_id, original_quote, confidence, created_at)
             VALUES (?, ?, ?, ?, ?, 1.0, ?)`
          ).run(generateId(), wsId, req.params.recordId, nextThemeId, String(existing.customer_text), new Date().toISOString());
          recalculateThemeMetadata(wsId, nextThemeId);
        }
        if (oldThemeId) recalculateThemeMetadata(wsId, oldThemeId);
      }

      const updated = db
        .prepare(
          `SELECT f.*, t.title as theme_title
           FROM feedback_records f
           LEFT JOIN pain_point_themes t ON t.id = f.theme_id
           WHERE f.id = ?`
        )
        .get(req.params.recordId) as Record<string, unknown> | undefined;
      res.json({
        record: updated
          ? {
              ...updated,
              churn_signal: Boolean(updated.churn_signal),
              human_corrected: Boolean(updated.human_corrected),
            }
          : null,
      });
    }
  );

  app.delete(
    '/api/workspaces/:workspaceId/feedback/:recordId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const wsId = req.workspace!.id;
      const existing = db
        .prepare('SELECT theme_id FROM feedback_records WHERE id = ? AND workspace_id = ?')
        .get(req.params.recordId, wsId) as { theme_id: string | null } | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Feedback record not found.' });
        return;
      }
      db.prepare('DELETE FROM feedback_records WHERE id = ? AND workspace_id = ?').run(req.params.recordId, wsId);
      if (existing.theme_id) recalculateThemeMetadata(wsId, existing.theme_id);
      res.json({ ok: true });
    }
  );

  // ============================================================================
  // AI ANALYSIS PIPELINE & JOB ORCHESTRATION (LAZY-LOADED @google/genai)
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/analysis/jobs', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const wsId = req.workspace!.id;
    const rows = db
      .prepare('SELECT * FROM analysis_jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 15')
      .all(wsId) as Array<Record<string, unknown>>;

    const jobs = rows.map((r) => {
      let stages: PipelineStage[] = [];
      try {
        stages = JSON.parse(String(r.stages_json || '[]'));
      } catch {
        stages = [];
      }
      return {
        id: String(r.id),
        workspace_id: String(r.workspace_id),
        status: String(r.status),
        total_records: Number(r.total_records || 0),
        processed_records: Number(r.processed_records || 0),
        failed_records: Number(r.failed_records || 0),
        current_stage: String(r.current_stage || 'validation'),
        stages,
        error_message: r.error_message ? String(r.error_message) : null,
        batch_size: Number(r.batch_size || 10),
        created_by: r.created_by ? String(r.created_by) : null,
        created_at: String(r.created_at),
        completed_at: r.completed_at ? String(r.completed_at) : null,
      };
    });

    const logs = db
      .prepare('SELECT * FROM ai_processing_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(wsId)
      .map((l: Record<string, unknown>) => ({ ...l, cache_hit: Boolean(l.cache_hit) }));

    res.json({ jobs, logs, runtime: getRuntimeStatus(wsId) });
  });

  app.post('/api/workspaces/:workspaceId/analysis/run', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const schema = z.object({
      batch_size: z.number().int().min(3).max(15).optional(),
      reprocess_all: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    const batchSize = parsed.success ? parsed.data.batch_size || 8 : 8;
    const reprocessAll = parsed.success ? Boolean(parsed.data.reprocess_all) : false;

    const wsId = req.workspace!.id;
    const targetCount = (
      (reprocessAll
        ? db.prepare('SELECT COUNT(*) as cnt FROM feedback_records WHERE workspace_id = ?').get(wsId)
        : db
            .prepare(
              `SELECT COUNT(*) as cnt FROM feedback_records WHERE workspace_id = ? AND processing_status IN ('pending', 'failed')`
            )
            .get(wsId)) as { cnt: number }
    ).cnt;

    if (targetCount === 0) {
      res.status(400).json({ error: 'All feedback records in this workspace are already processed. Upload new records or select Reprocess All.' });
      return;
    }

    const jobId = generateId();
    const now = new Date().toISOString();
    const stages = createInitialStages();

    db.prepare(
      `INSERT INTO analysis_jobs (
        id, workspace_id, status, total_records, processed_records, failed_records,
        current_stage, stages_json, error_message, batch_size, created_by, created_at, completed_at
      ) VALUES (?, ?, 'queued', ?, 0, 0, 'validation', ?, NULL, ?, ?, ?, NULL)`
    ).run(jobId, wsId, targetCount, JSON.stringify(stages), batchSize, req.user!.id, now);

    void import('./ai/geminiPipeline.ts')
      .then(({ executeWorkspaceAnalysisPipeline }) =>
        executeWorkspaceAnalysisPipeline({
          workspaceId: wsId,
          jobId,
          batchSize,
          reprocessAll,
        })
      )
      .catch((err) => {
        console.error('Failed to trigger Gemini pipeline:', err);
      });

    res.status(202).json({
      job: {
        id: jobId,
        workspace_id: wsId,
        status: 'queued',
        total_records: targetCount,
        processed_records: 0,
        failed_records: 0,
        current_stage: 'validation',
        stages,
        error_message: null,
        batch_size: batchSize,
        created_by: req.user!.id,
        created_at: now,
        completed_at: null,
      },
    });
  });

  app.post(
    '/api/workspaces/:workspaceId/analysis/jobs/:jobId/retry',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const wsId = req.workspace!.id;
      const oldJob = db
        .prepare('SELECT * FROM analysis_jobs WHERE id = ? AND workspace_id = ?')
        .get(req.params.jobId, wsId) as Record<string, unknown> | undefined;
      if (!oldJob) {
        res.status(404).json({ error: 'Analysis job not found.' });
        return;
      }

      const stages = createInitialStages();
      db.prepare(
        `UPDATE analysis_jobs
         SET status = 'queued', current_stage = 'validation', stages_json = ?, error_message = NULL, completed_at = NULL
         WHERE id = ?`
      ).run(JSON.stringify(stages), req.params.jobId);

      void import('./ai/geminiPipeline.ts')
        .then(({ executeWorkspaceAnalysisPipeline }) =>
          executeWorkspaceAnalysisPipeline({
            workspaceId: wsId,
            jobId: String(req.params.jobId),
            batchSize: Number(oldJob.batch_size || 8),
            reprocessAll: false,
          })
        )
        .catch((err) => {
          console.error('Failed to retry Gemini pipeline:', err);
        });

      res.status(202).json({ ok: true, job_id: req.params.jobId });
    }
  );

  // ============================================================================
  // PAIN POINT THEMES (EXPLORE, REVIEW, RENAME, MERGE, SPLIT)
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/themes', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    res.json({ themes: getWorkspaceThemesWithEvidence(req.workspace!.id) });
  });

  app.patch(
    '/api/workspaces/:workspaceId/themes/:themeId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        title: z.string().min(3).max(160).optional(),
        description: z.string().min(5).max(1000).optional(),
        why_happening: z.string().max(1000).optional(),
        next_investigation: z.string().max(1000).optional(),
        severity: z.enum(['Low', 'Medium', 'High']).optional(),
        severity_reasoning: z.string().max(1000).optional(),
        review_status: z.enum(['Needs Review', 'Verified', 'Flagged']).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid theme update fields.' });
        return;
      }

      const wsId = req.workspace!.id;
      const existing = db
        .prepare('SELECT * FROM pain_point_themes WHERE id = ? AND workspace_id = ?')
        .get(req.params.themeId, wsId) as Record<string, SQLInputValue> | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Theme not found.' });
        return;
      }

      const d = parsed.data;
      db.prepare(
        `UPDATE pain_point_themes
         SET title = ?, description = ?, why_happening = ?, next_investigation = ?,
             severity = ?, severity_reasoning = ?, review_status = ?, human_corrected = 1, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      ).run(
        d.title?.trim() ?? existing.title,
        d.description?.trim() ?? existing.description,
        d.why_happening?.trim() ?? existing.why_happening,
        d.next_investigation?.trim() ?? existing.next_investigation,
        d.severity ?? existing.severity,
        d.severity_reasoning?.trim() ?? existing.severity_reasoning,
        d.review_status ?? existing.review_status,
        new Date().toISOString(),
        req.params.themeId,
        wsId
      );

      res.json({ themes: getWorkspaceThemesWithEvidence(wsId) });
    }
  );

  app.post('/api/workspaces/:workspaceId/themes/merge', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const schema = z.object({
      source_theme_id: z.string().min(1),
      target_theme_id: z.string().min(1),
      new_title: z.string().min(3).max(160).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || parsed.data.source_theme_id === parsed.data.target_theme_id) {
      res.status(400).json({ error: 'Select two distinct themes to merge.' });
      return;
    }

    const wsId = req.workspace!.id;
    const { source_theme_id, target_theme_id, new_title } = parsed.data;
    const source = db
      .prepare('SELECT * FROM pain_point_themes WHERE id = ? AND workspace_id = ?')
      .get(source_theme_id, wsId);
    const target = db
      .prepare('SELECT * FROM pain_point_themes WHERE id = ? AND workspace_id = ?')
      .get(target_theme_id, wsId);
    if (!source || !target) {
      res.status(404).json({ error: 'One or both themes were not found in this workspace.' });
      return;
    }

    db.prepare('UPDATE feedback_records SET theme_id = ? WHERE theme_id = ? AND workspace_id = ?').run(
      target_theme_id,
      source_theme_id,
      wsId
    );

    const sourceEv = db
      .prepare('SELECT feedback_record_id, original_quote, confidence FROM evidence_records WHERE theme_id = ? AND workspace_id = ?')
      .all(source_theme_id, wsId) as Array<{ feedback_record_id: string; original_quote: string; confidence: number }>;

    for (const ev of sourceEv) {
      db.prepare(
        `INSERT OR IGNORE INTO evidence_records (id, workspace_id, feedback_record_id, theme_id, original_quote, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(generateId(), wsId, ev.feedback_record_id, target_theme_id, ev.original_quote, ev.confidence, new Date().toISOString());
    }

    db.prepare('UPDATE opportunities SET theme_id = ? WHERE theme_id = ? AND workspace_id = ?').run(
      target_theme_id,
      source_theme_id,
      wsId
    );
    db.prepare('DELETE FROM pain_point_themes WHERE id = ? AND workspace_id = ?').run(source_theme_id, wsId);

    if (new_title?.trim()) {
      db.prepare('UPDATE pain_point_themes SET title = ?, human_corrected = 1 WHERE id = ?').run(
        new_title.trim(),
        target_theme_id
      );
    } else {
      db.prepare('UPDATE pain_point_themes SET human_corrected = 1 WHERE id = ?').run(target_theme_id);
    }

    recalculateThemeMetadata(wsId, target_theme_id);
    res.json({ themes: getWorkspaceThemesWithEvidence(wsId) });
  });

  app.post(
    '/api/workspaces/:workspaceId/themes/:themeId/split',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        new_title: z.string().min(3).max(160),
        new_description: z.string().min(5).max(800),
        feedback_record_ids: z.array(z.string()).min(1, 'Select at least one supporting record to split out.'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid split request.' });
        return;
      }

      const wsId = req.workspace!.id;
      const parent = db
        .prepare('SELECT * FROM pain_point_themes WHERE id = ? AND workspace_id = ?')
        .get(req.params.themeId, wsId) as Record<string, unknown> | undefined;
      if (!parent) {
        res.status(404).json({ error: 'Source theme not found.' });
        return;
      }

      const now = new Date().toISOString();
      const newThemeId = generateId();
      db.prepare(
        `INSERT INTO pain_point_themes (
          id, workspace_id, title, description, why_happening, next_investigation,
          frequency, severity, severity_reasoning, sentiment, affected_segments,
          first_reported_date, latest_reported_date, trend_summary, confidence,
          evidence_strength, review_status, human_corrected, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, '[]', NULL, NULL, 'Split manually by Product Manager', 0.9, 'Insufficient', 'Verified', 1, ?, ?)`
      ).run(
        newThemeId,
        wsId,
        parsed.data.new_title.trim(),
        parsed.data.new_description.trim(),
        String(parent.why_happening || ''),
        String(parent.next_investigation || ''),
        String(parent.severity || 'Medium'),
        String(parent.severity_reasoning || ''),
        String(parent.sentiment || 'Negative'),
        now,
        now
      );

      for (const recId of parsed.data.feedback_record_ids) {
        const fb = db
          .prepare('SELECT id, customer_text FROM feedback_records WHERE id = ? AND workspace_id = ?')
          .get(recId, wsId) as { id: string; customer_text: string } | undefined;
        if (!fb) continue;
        db.prepare('DELETE FROM evidence_records WHERE feedback_record_id = ? AND theme_id = ?').run(
          recId,
          req.params.themeId
        );
        db.prepare('UPDATE feedback_records SET theme_id = ?, human_corrected = 1 WHERE id = ?').run(newThemeId, recId);
        db.prepare(
          `INSERT OR IGNORE INTO evidence_records (id, workspace_id, feedback_record_id, theme_id, original_quote, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, 1.0, ?)`
        ).run(generateId(), wsId, recId, newThemeId, fb.customer_text, now);
      }

      recalculateThemeMetadata(wsId, String(req.params.themeId));
      recalculateThemeMetadata(wsId, newThemeId);
      res.status(201).json({ new_theme_id: newThemeId, themes: getWorkspaceThemesWithEvidence(wsId) });
    }
  );

  // ============================================================================
  // OPPORTUNITIES & DYNAMIC RICE PRIORITISATION
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/opportunities', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    res.json({ opportunities: getWorkspaceOpportunities(req.workspace!.id) });
  });

  app.post(
    '/api/workspaces/:workspaceId/opportunities',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        theme_id: z.string().nullable().optional(),
        title: z.string().min(3).max(160),
        problem_statement: z.string().min(5).max(1000),
        customer_impact: z.string().max(600).optional(),
        business_impact: z.string().max(600).optional(),
        proposed_solution: z.string().max(1000).optional(),
        recommended_next_action: z.string().max(600).optional(),
        assumptions: z.array(z.string()).optional(),
        risks: z.array(z.string()).optional(),
        reach: z.number().min(1).max(100000),
        impact: z.number().min(0.25).max(3.0),
        confidence: z.number().min(10).max(100),
        effort: z.number().min(0.5).max(52),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid opportunity inputs.' });
        return;
      }

      const d = parsed.data;
      const rice = computeRiceScore(d.reach, d.impact, d.confidence, d.effort);
      const priority = derivePriorityFromRice(rice);
      const now = new Date().toISOString();
      const id = generateId();

      db.prepare(
        `INSERT INTO opportunities (
          id, workspace_id, theme_id, title, problem_statement, customer_impact,
          business_impact, proposed_solution, recommended_next_action, assumptions,
          risks, reach, impact, confidence, effort, rice_score, priority,
          recommendation, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposed', ?, ?)`
      ).run(
        id,
        req.workspace!.id,
        d.theme_id || null,
        d.title.trim(),
        d.problem_statement.trim(),
        d.customer_impact?.trim() || '',
        d.business_impact?.trim() || '',
        d.proposed_solution?.trim() || '',
        d.recommended_next_action?.trim() || '',
        JSON.stringify(d.assumptions || []),
        JSON.stringify(d.risks || []),
        Math.round(d.reach),
        d.impact,
        Math.round(d.confidence),
        d.effort,
        rice,
        priority,
        `Suggested recommendation (RICE ${rice}): ${d.recommended_next_action || d.proposed_solution || 'Validate scope with engineering.'}`,
        now,
        now
      );

      res.status(201).json({ id, opportunities: getWorkspaceOpportunities(req.workspace!.id) });
    }
  );

  app.patch(
    '/api/workspaces/:workspaceId/opportunities/:opportunityId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        title: z.string().min(3).max(160).optional(),
        problem_statement: z.string().min(5).max(1000).optional(),
        proposed_solution: z.string().max(1000).optional(),
        recommended_next_action: z.string().max(600).optional(),
        reach: z.number().min(1).max(100000).optional(),
        impact: z.number().min(0.25).max(3.0).optional(),
        confidence: z.number().min(10).max(100).optional(),
        effort: z.number().min(0.5).max(52).optional(),
        status: z.enum(['Proposed', 'Under Review', 'Approved', 'Converted', 'Deferred']).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid RICE or opportunity update values.' });
        return;
      }

      const wsId = req.workspace!.id;
      const existing = db
        .prepare('SELECT * FROM opportunities WHERE id = ? AND workspace_id = ?')
        .get(req.params.opportunityId, wsId) as Record<string, SQLInputValue> | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Opportunity not found.' });
        return;
      }

      const d = parsed.data;
      const reach = d.reach !== undefined ? Math.round(d.reach) : Number(existing.reach);
      const impact = d.impact !== undefined ? d.impact : Number(existing.impact);
      const confidence = d.confidence !== undefined ? Math.round(d.confidence) : Number(existing.confidence);
      const effort = d.effort !== undefined ? d.effort : Number(existing.effort);
      const rice = computeRiceScore(reach, impact, confidence, effort);
      const priority = derivePriorityFromRice(rice);

      db.prepare(
        `UPDATE opportunities
         SET title = ?, problem_statement = ?, proposed_solution = ?, recommended_next_action = ?,
             reach = ?, impact = ?, confidence = ?, effort = ?, rice_score = ?, priority = ?,
             status = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      ).run(
        d.title?.trim() ?? existing.title,
        d.problem_statement?.trim() ?? existing.problem_statement,
        d.proposed_solution?.trim() ?? existing.proposed_solution,
        d.recommended_next_action?.trim() ?? existing.recommended_next_action,
        reach,
        impact,
        confidence,
        effort,
        rice,
        priority,
        d.status ?? existing.status,
        new Date().toISOString(),
        req.params.opportunityId,
        wsId
      );

      res.json({ opportunities: getWorkspaceOpportunities(wsId) });
    }
  );

  app.delete(
    '/api/workspaces/:workspaceId/opportunities/:opportunityId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      db.prepare('DELETE FROM opportunities WHERE id = ? AND workspace_id = ?').run(
        req.params.opportunityId,
        req.workspace!.id
      );
      res.json({ opportunities: getWorkspaceOpportunities(req.workspace!.id) });
    }
  );

  // ============================================================================
  // ACTION PLANS (CRUD + OPPORTUNITY CONVERSION)
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/action-plans', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    res.json({ action_plans: getWorkspaceActionPlans(req.workspace!.id) });
  });

  app.post(
    '/api/workspaces/:workspaceId/action-plans',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        opportunity_id: z.string().nullable().optional(),
        title: z.string().min(3).max(180),
        problem_statement: z.string().max(1000).optional(),
        evidence_summary: z.string().max(1000).optional(),
        description: z.string().max(1500).optional(),
        expected_impact: z.string().max(600).optional(),
        owner: z.string().min(2).max(120),
        priority: z.enum(['P0 - Critical', 'P1 - High', 'P2 - Medium', 'P3 - Low']).default('P1 - High'),
        status: z.enum(['Not started', 'In progress', 'Completed']).default('Not started'),
        next_steps: z.array(z.string()).default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid action plan payload.' });
        return;
      }

      const d = parsed.data;
      const now = new Date().toISOString();
      const id = generateId();
      const wsId = req.workspace!.id;

      db.prepare(
        `INSERT INTO action_plans (
          id, workspace_id, opportunity_id, title, problem_statement, evidence_summary,
          description, expected_impact, owner, priority, status, next_steps, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        wsId,
        d.opportunity_id || null,
        d.title.trim(),
        d.problem_statement?.trim() || '',
        d.evidence_summary?.trim() || '',
        d.description?.trim() || '',
        d.expected_impact?.trim() || '',
        d.owner.trim(),
        d.priority,
        d.status,
        JSON.stringify(d.next_steps.filter((s) => s.trim().length > 0)),
        now,
        now
      );

      if (d.opportunity_id) {
        db.prepare(`UPDATE opportunities SET status = 'Converted', updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
          now,
          d.opportunity_id,
          wsId
        );
      }

      res.status(201).json({ id, action_plans: getWorkspaceActionPlans(wsId) });
    }
  );

  app.patch(
    '/api/workspaces/:workspaceId/action-plans/:planId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      const schema = z.object({
        title: z.string().min(3).max(180).optional(),
        problem_statement: z.string().max(1000).optional(),
        evidence_summary: z.string().max(1000).optional(),
        description: z.string().max(1500).optional(),
        expected_impact: z.string().max(600).optional(),
        owner: z.string().min(2).max(120).optional(),
        priority: z.enum(['P0 - Critical', 'P1 - High', 'P2 - Medium', 'P3 - Low']).optional(),
        status: z.enum(['Not started', 'In progress', 'Completed']).optional(),
        next_steps: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid action plan update.' });
        return;
      }

      const wsId = req.workspace!.id;
      const existing = db
        .prepare('SELECT * FROM action_plans WHERE id = ? AND workspace_id = ?')
        .get(req.params.planId, wsId) as Record<string, SQLInputValue> | undefined;
      if (!existing) {
        res.status(404).json({ error: 'Action plan not found.' });
        return;
      }

      const d = parsed.data;
      db.prepare(
        `UPDATE action_plans
         SET title = ?, problem_statement = ?, evidence_summary = ?, description = ?,
             expected_impact = ?, owner = ?, priority = ?, status = ?, next_steps = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      ).run(
        d.title?.trim() ?? existing.title,
        d.problem_statement?.trim() ?? existing.problem_statement,
        d.evidence_summary?.trim() ?? existing.evidence_summary,
        d.description?.trim() ?? existing.description,
        d.expected_impact?.trim() ?? existing.expected_impact,
        d.owner?.trim() ?? existing.owner,
        d.priority ?? existing.priority,
        d.status ?? existing.status,
        d.next_steps ? JSON.stringify(d.next_steps.filter((s) => s.trim().length > 0)) : existing.next_steps,
        new Date().toISOString(),
        req.params.planId,
        wsId
      );

      res.json({ action_plans: getWorkspaceActionPlans(wsId) });
    }
  );

  app.delete(
    '/api/workspaces/:workspaceId/action-plans/:planId',
    requireAuth,
    requireWorkspaceAccess,
    (req: AuthedRequest, res) => {
      db.prepare('DELETE FROM action_plans WHERE id = ? AND workspace_id = ?').run(req.params.planId, req.workspace!.id);
      res.json({ action_plans: getWorkspaceActionPlans(req.workspace!.id) });
    }
  );

  // ============================================================================
  // EXECUTIVE REPORT & AI EVALUATION & SCHEMA VIEWER
  // ============================================================================
  app.get('/api/workspaces/:workspaceId/report', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const metrics = computeDashboardMetrics(ws);
    const themes = getWorkspaceThemesWithEvidence(ws.id);
    const opportunities = getWorkspaceOpportunities(ws.id);
    const action_plans = getWorkspaceActionPlans(ws.id);
    const churn_signals = db
      .prepare(
        `SELECT id, feedback_id, customer_id, customer_segment, source, feedback_date, customer_text,
                churn_signal_type, churn_concern_level, churn_reasoning, churn_followup, churn_status
         FROM feedback_records
         WHERE workspace_id = ? AND churn_signal = 1
         ORDER BY CASE churn_concern_level WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, feedback_date DESC`
      )
      .all(ws.id);

    res.json({
      generated_at: new Date().toISOString(),
      workspace: ws,
      metrics,
      themes,
      opportunities,
      action_plans,
      churn_signals,
      limitations: [
        ws.is_demo
          ? 'This workspace contains the 100-record illustrative sample dataset for Acme Technologies; figures reflect those 100 stored records.'
          : 'All figures reflect only feedback records currently stored and analyzed inside this workspace.',
        'Potential churn signals are evidence-based qualitative flags derived from customer feedback language — not a predictive churn probability model.',
        'AI-generated opportunity scores and solutions are decision-support recommendations subject to Product Manager review.',
        `Current workspace evidence traceability: ${(getWorkspaceEvidenceTraceability(ws.id) * 100).toFixed(1)}% exact verbatim quote match; human correction rate: ${(getWorkspaceHumanCorrectionRate(ws.id) * 100).toFixed(1)}%.`,
      ],
    });
  });

  app.get('/api/workspaces/:workspaceId/evaluation', requireAuth, requireWorkspaceAccess, (req: AuthedRequest, res) => {
    const wsId = req.workspace!.id;
    const runRows = db
      .prepare('SELECT * FROM evaluation_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(wsId) as Array<Record<string, unknown>>;

    const measuredRuns = runRows.map((r) => ({
      id: String(r.id),
      workspace_id: String(r.workspace_id),
      mode: String(r.mode),
      dataset_size: Number(r.dataset_size),
      classification_precision: Number(r.classification_precision),
      classification_recall: Number(r.classification_recall),
      sentiment_agreement: Number(r.sentiment_agreement),
      theme_grouping_quality: Number(r.theme_grouping_quality),
      evidence_traceability: Number(r.evidence_traceability),
      invalid_ai_responses: Number(r.invalid_ai_responses),
      human_correction_rate: Number(r.human_correction_rate),
      details: JSON.parse(String(r.details_json || '[]')),
      created_at: String(r.created_at),
    }));

    res.json({
      proposed_targets: PROPOSED_EVALUATION_TARGETS,
      golden_dataset: GOLDEN_EVALUATION_DATASET,
      workspace_live_governance: {
        evidence_traceability: getWorkspaceEvidenceTraceability(wsId),
        human_correction_rate: getWorkspaceHumanCorrectionRate(wsId),
        invalid_ai_responses: getWorkspaceInvalidResponsesCount(wsId),
      },
      measured_runs: measuredRuns,
      gemini_configured: isGeminiConfigured(),
    });
  });

  app.post(
    '/api/workspaces/:workspaceId/evaluation/run',
    requireAuth,
    requireWorkspaceAccess,
    async (req: AuthedRequest, res) => {
      try {
        const result = await runLiveGoldenEvaluation(req.workspace!.id);
        res.status(201).json({ run: result });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code) {
          res.status(code === 'QUOTA_EXHAUSTED' || code === 'RATE_LIMITED' ? 429 : 400).json({
            error: err instanceof Error ? err.message : 'Evaluation failed.',
            code,
          });
          return;
        }
        res.status(500).json({ error: err instanceof Error ? err.message : 'Evaluation failed.' });
      }
    }
  );

  app.get('/api/system/schema-sql', requireAuth, (_req, res) => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql');
    const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '-- Migration file not found';
    res.json({ sql });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, runtime: getRuntimeStatus() });
  });

  return app;
}
