-- ============================================================================
-- VOICE OF CUSTOMER COPILOT — SUPABASE POSTGRESQL SCHEMA MIGRATION
-- Safe, idempotent migration (uses IF NOT EXISTS; never drops existing tables)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  role_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. workspaces
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL DEFAULT 'SaaS',
  business_type TEXT NOT NULL DEFAULT 'B2B',
  user_role TEXT NOT NULL DEFAULT 'Product Manager',
  primary_objective TEXT NOT NULL DEFAULT 'Improve customer retention',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. workspace_members
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited')),
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email)
);

-- 5. pain_point_themes (created before feedback_records FK reference)
CREATE TABLE IF NOT EXISTS public.pain_point_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  why_happening TEXT NOT NULL DEFAULT '',
  next_investigation TEXT NOT NULL DEFAULT '',
  frequency INTEGER NOT NULL DEFAULT 0 CHECK (frequency >= 0),
  severity TEXT NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Low', 'Medium', 'High')),
  severity_reasoning TEXT NOT NULL DEFAULT '',
  sentiment TEXT NOT NULL DEFAULT 'Negative' CHECK (sentiment IN ('Positive', 'Negative', 'Neutral', 'Mixed', 'Uncertain')),
  affected_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_reported_date DATE,
  latest_reported_date DATE,
  trend_summary TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.75 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_strength TEXT NOT NULL DEFAULT 'Insufficient' CHECK (evidence_strength IN ('Strong', 'Moderate', 'Insufficient')),
  review_status TEXT NOT NULL DEFAULT 'Needs Review' CHECK (review_status IN ('Needs Review', 'Verified', 'Flagged')),
  human_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. feedback_records
CREATE TABLE IF NOT EXISTS public.feedback_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  feedback_id TEXT NOT NULL,
  customer_text TEXT NOT NULL CHECK (char_length(trim(customer_text)) >= 3),
  text_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Manual Entry',
  customer_segment TEXT NOT NULL DEFAULT 'General',
  customer_id TEXT,
  product_area TEXT NOT NULL DEFAULT 'General',
  feedback_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sentiment TEXT CHECK (sentiment IN ('Positive', 'Negative', 'Neutral', 'Mixed', 'Uncertain')),
  sentiment_reasoning TEXT,
  category TEXT,
  customer_intent TEXT,
  main_issue TEXT,
  problem_description TEXT,
  severity TEXT CHECK (severity IN ('Low', 'Medium', 'High')),
  severity_reasoning TEXT,
  classification_confidence NUMERIC(4, 3) CHECK (classification_confidence >= 0 AND classification_confidence <= 1),
  churn_signal BOOLEAN NOT NULL DEFAULT FALSE,
  churn_signal_type TEXT,
  churn_concern_level TEXT CHECK (churn_concern_level IN ('Low', 'Medium', 'High')),
  churn_reasoning TEXT,
  churn_followup TEXT,
  churn_status TEXT NOT NULL DEFAULT 'Open' CHECK (churn_status IN ('Open', 'Investigating', 'Addressed')),
  theme_id UUID REFERENCES public.pain_point_themes(id) ON DELETE SET NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  human_corrected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, feedback_id)
);

-- 6. evidence_records
CREATE TABLE IF NOT EXISTS public.evidence_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  feedback_record_id UUID NOT NULL REFERENCES public.feedback_records(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES public.pain_point_themes(id) ON DELETE CASCADE,
  original_quote TEXT NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.85 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feedback_record_id, theme_id)
);

-- 7. analysis_jobs
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  total_records INTEGER NOT NULL DEFAULT 0,
  processed_records INTEGER NOT NULL DEFAULT 0,
  failed_records INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT 'validation',
  stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  batch_size INTEGER NOT NULL DEFAULT 10,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 8. opportunities
CREATE TABLE IF NOT EXISTS public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  theme_id UUID REFERENCES public.pain_point_themes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL,
  customer_impact TEXT NOT NULL DEFAULT '',
  business_impact TEXT NOT NULL DEFAULT '',
  proposed_solution TEXT NOT NULL DEFAULT '',
  recommended_next_action TEXT NOT NULL DEFAULT '',
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  reach INTEGER NOT NULL DEFAULT 100 CHECK (reach >= 1),
  impact NUMERIC(4, 2) NOT NULL DEFAULT 1.0 CHECK (impact >= 0.25 AND impact <= 3.0),
  confidence INTEGER NOT NULL DEFAULT 70 CHECK (confidence >= 10 AND confidence <= 100),
  effort NUMERIC(5, 2) NOT NULL DEFAULT 2.0 CHECK (effort >= 0.5),
  rice_score NUMERIC(10, 2) NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'P2 - Medium' CHECK (priority IN ('P0 - Critical', 'P1 - High', 'P2 - Medium', 'P3 - Low')),
  recommendation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Under Review', 'Approved', 'Converted', 'Deferred')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. action_plans
CREATE TABLE IF NOT EXISTS public.action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  problem_statement TEXT NOT NULL DEFAULT '',
  evidence_summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  expected_impact TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT 'Product Manager',
  priority TEXT NOT NULL DEFAULT 'P1 - High' CHECK (priority IN ('P0 - Critical', 'P1 - High', 'P2 - Medium', 'P3 - Low')),
  status TEXT NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started', 'In progress', 'Completed')),
  next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. ai_processing_logs
CREATE TABLE IF NOT EXISTS public.ai_processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.analysis_jobs(id) ON DELETE SET NULL,
  workflow_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  records_count INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'quota_exceeded', 'invalid_json')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_workspace_members_ws_user ON public.workspace_members(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ws_date ON public.feedback_records(workspace_id, feedback_date DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_ws_status ON public.feedback_records(workspace_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_feedback_ws_hash ON public.feedback_records(workspace_id, text_hash);
CREATE INDEX IF NOT EXISTS idx_feedback_ws_theme ON public.feedback_records(workspace_id, theme_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ws_churn ON public.feedback_records(workspace_id, churn_signal);
CREATE INDEX IF NOT EXISTS idx_themes_ws_severity ON public.pain_point_themes(workspace_id, severity, frequency DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_ws_theme ON public.evidence_records(workspace_id, theme_id);
CREATE INDEX IF NOT EXISTS idx_jobs_ws_created ON public.analysis_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_ws_rice ON public.opportunities(workspace_id, rice_score DESC);
CREATE INDEX IF NOT EXISTS idx_actions_ws_status ON public.action_plans(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_logs_ws_created ON public.ai_processing_logs(workspace_id, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) & WORKSPACE ISOLATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
  );
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pain_point_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_processing_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update only their own profile
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_self_select') THEN
    CREATE POLICY profiles_self_select ON public.profiles FOR SELECT USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_self_update') THEN
    CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

-- Workspaces: accessible strictly to active workspace members
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workspaces_member_access') THEN
    CREATE POLICY workspaces_member_access ON public.workspaces
      FOR ALL USING (public.is_workspace_member(id))
      WITH CHECK (auth.uid() = created_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'workspace_members_member_read') THEN
    CREATE POLICY workspace_members_member_read ON public.workspace_members
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'feedback_workspace_isolation') THEN
    CREATE POLICY feedback_workspace_isolation ON public.feedback_records
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'themes_workspace_isolation') THEN
    CREATE POLICY themes_workspace_isolation ON public.pain_point_themes
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'evidence_workspace_isolation') THEN
    CREATE POLICY evidence_workspace_isolation ON public.evidence_records
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'jobs_workspace_isolation') THEN
    CREATE POLICY jobs_workspace_isolation ON public.analysis_jobs
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'opportunities_workspace_isolation') THEN
    CREATE POLICY opportunities_workspace_isolation ON public.opportunities
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'action_plans_workspace_isolation') THEN
    CREATE POLICY action_plans_workspace_isolation ON public.action_plans
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ai_logs_workspace_isolation') THEN
    CREATE POLICY ai_logs_workspace_isolation ON public.ai_processing_logs
      FOR ALL USING (public.is_workspace_member(workspace_id));
  END IF;
END $$;

-- Private Storage Bucket for Raw CSV Uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voc-csv-uploads', 'voc-csv-uploads', false, 5242880, ARRAY['text/csv', 'text/plain'])
ON CONFLICT (id) DO NOTHING;
