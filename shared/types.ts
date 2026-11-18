export type SentimentType = 'Positive' | 'Negative' | 'Neutral' | 'Mixed' | 'Uncertain';
export type SeverityLevel = 'Low' | 'Medium' | 'High';
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type EvidenceStrength = 'Strong' | 'Moderate' | 'Insufficient';
export type ReviewStatus = 'Needs Review' | 'Verified' | 'Flagged';
export type ActionStatus = 'Not started' | 'In progress' | 'Completed';
export type PriorityLevel = 'P0 - Critical' | 'P1 - High' | 'P2 - Medium' | 'P3 - Low';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ChurnConcernLevel = 'High' | 'Medium' | 'Low';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role_title: string | null;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  company_name: string;
  industry: string;
  business_type: string;
  user_role: string;
  primary_objective: string;
  is_demo: boolean;
  created_by: string;
  created_at: string;
  member_role?: WorkspaceRole;
  feedback_count?: number;
  analyzed_count?: number;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string | null;
  email: string;
  full_name?: string | null;
  role: WorkspaceRole;
  status: 'active' | 'invited';
  invited_by: string | null;
  created_at: string;
}

export interface FeedbackRecord {
  id: string;
  workspace_id: string;
  feedback_id: string;
  customer_text: string;
  text_hash: string;
  source: string;
  customer_segment: string;
  customer_id: string | null;
  product_area: string;
  feedback_date: string;
  sentiment: SentimentType | null;
  sentiment_reasoning: string | null;
  category: string | null;
  customer_intent: string | null;
  main_issue: string | null;
  problem_description: string | null;
  severity: SeverityLevel | null;
  severity_reasoning: string | null;
  classification_confidence: number | null;
  churn_signal: boolean;
  churn_signal_type: string | null;
  churn_concern_level: ChurnConcernLevel | null;
  churn_reasoning: string | null;
  churn_followup: string | null;
  churn_status: 'Open' | 'Investigating' | 'Addressed';
  theme_id: string | null;
  theme_title?: string | null;
  processing_status: ProcessingStatus;
  human_corrected: boolean;
  created_at: string;
}

export interface EvidenceRecord {
  id: string;
  workspace_id: string;
  feedback_record_id: string;
  theme_id: string;
  original_quote: string;
  confidence: number;
  created_at: string;
  feedback_id?: string;
  source?: string;
  feedback_date?: string;
  customer_segment?: string;
  customer_id?: string | null;
  sentiment?: SentimentType | null;
  severity?: SeverityLevel | null;
}

export interface PainPointTheme {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  why_happening: string;
  next_investigation: string;
  frequency: number;
  severity: SeverityLevel;
  severity_reasoning: string;
  sentiment: SentimentType;
  affected_segments: string[];
  first_reported_date: string | null;
  latest_reported_date: string | null;
  trend_summary: string;
  confidence: number;
  evidence_strength: EvidenceStrength;
  review_status: ReviewStatus;
  human_corrected: boolean;
  created_at: string;
  updated_at: string;
  evidence?: EvidenceRecord[];
}

export interface PipelineStage {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  detail?: string;
  started_at?: string;
  completed_at?: string;
}

export interface AnalysisJob {
  id: string;
  workspace_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  total_records: number;
  processed_records: number;
  failed_records: number;
  current_stage: string;
  stages: PipelineStage[];
  error_message: string | null;
  batch_size: number;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Opportunity {
  id: string;
  workspace_id: string;
  theme_id: string | null;
  theme_title?: string | null;
  title: string;
  problem_statement: string;
  customer_impact: string;
  business_impact: string;
  proposed_solution: string;
  recommended_next_action: string;
  assumptions: string[];
  risks: string[];
  reach: number;
  impact: number;
  confidence: number;
  effort: number;
  rice_score: number;
  priority: PriorityLevel;
  recommendation: string;
  status: 'Proposed' | 'Under Review' | 'Approved' | 'Converted' | 'Deferred';
  evidence_count?: number;
  sample_quotes?: Array<{
    feedback_id: string;
    original_quote: string;
    customer_segment: string;
    source: string;
    feedback_date: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface ActionPlan {
  id: string;
  workspace_id: string;
  opportunity_id: string | null;
  opportunity_title?: string | null;
  title: string;
  problem_statement: string;
  evidence_summary: string;
  description: string;
  expected_impact: string;
  owner: string;
  priority: PriorityLevel;
  status: ActionStatus;
  next_steps: string[];
  created_at: string;
  updated_at: string;
}

export interface AIProcessingLog {
  id: string;
  workspace_id: string;
  job_id: string | null;
  workflow_name: string;
  model_name: string;
  records_count: number;
  prompt_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cache_hit: boolean;
  status: 'success' | 'error' | 'quota_exceeded' | 'invalid_json';
  error_message: string | null;
  created_at: string;
}

export interface CsvImportSummary {
  total_records: number;
  valid_records: number;
  duplicate_records: number;
  invalid_records: number;
  saved_ids: string[];
  duplicates: Array<{ row_index: number; feedback_id: string; reason: string; preview: string }>;
  invalids: Array<{ row_index: number; feedback_id: string; reason: string; preview: string }>;
  import_status: 'completed' | 'partial' | 'rejected';
}

export interface DashboardMetrics {
  workspace: Workspace;
  summary: {
    total_feedback: number;
    analyzed_feedback: number;
    pending_feedback: number;
    identified_issues: number;
    major_themes: number;
    high_severity_themes: number;
    potential_churn_signals: number;
    high_concern_churn: number;
    prioritised_opportunities: number;
    active_action_plans: number;
    completed_action_plans: number;
    negative_share_pct: number;
    positive_share_pct: number;
    human_correction_rate_pct: number;
  };
  volume_trend: Array<{
    period: string;
    total: number;
    negative: number;
    positive: number;
    neutral_mixed: number;
  }>;
  sentiment_distribution: Array<{
    sentiment: SentimentType;
    count: number;
    percentage: number;
  }>;
  source_distribution: Array<{
    source: string;
    count: number;
    negative_count: number;
  }>;
  segment_comparison: Array<{
    segment: string;
    total: number;
    negative: number;
    high_severity: number;
    churn_signals: number;
  }>;
  product_area_breakdown: Array<{
    product_area: string;
    total: number;
    negative: number;
    positive: number;
    high_severity: number;
  }>;
  sentiment_vs_severity: Array<{
    sentiment: SentimentType;
    low: number;
    medium: number;
    high: number;
  }>;
  top_pain_points: PainPointTheme[];
  emerging_issues: Array<{
    theme_id: string;
    title: string;
    recent_count: number;
    prior_count: number;
    growth_label: string;
    severity: SeverityLevel;
    evidence_strength: EvidenceStrength;
  }>;
  critical_insights: Array<{
    id: string;
    title: string;
    category: string;
    severity: SeverityLevel;
    evidence_count: number;
    summary: string;
    recommended_action: string;
  }>;
  recommended_actions: Opportunity[];
}

export interface GoldenEvaluationItem {
  id: string;
  feedback_text: string;
  customer_segment: string;
  source: string;
  expected_category: string;
  expected_product_area: string;
  expected_sentiment: SentimentType;
  expected_severity: SeverityLevel;
  expected_theme_keyword: string;
  notes: string;
}

export interface EvaluationRunResult {
  id: string;
  workspace_id: string;
  mode: 'live_gemini' | 'illustrative_baseline';
  dataset_size: number;
  classification_precision: number;
  classification_recall: number;
  sentiment_agreement: number;
  theme_grouping_quality: number;
  evidence_traceability: number;
  invalid_ai_responses: number;
  human_correction_rate: number;
  details: Array<{
    item_id: string;
    feedback_text: string;
    expected_category: string;
    predicted_category: string;
    expected_sentiment: SentimentType;
    predicted_sentiment: SentimentType;
    expected_severity: SeverityLevel;
    predicted_severity: SeverityLevel;
    category_match: boolean;
    sentiment_match: boolean;
    severity_match: boolean;
    valid_json: boolean;
    evidence_verbatim: boolean;
  }>;
  created_at: string;
}

export interface RuntimeStatus {
  database_mode: 'supabase_postgresql' | 'local_sqlite_mirror';
  supabase_configured: boolean;
  gemini_configured: boolean;
  gemini_model: string;
  free_tier_hourly_limit: number;
  workspace_requests_last_hour: number;
  total_tokens_used: number;
  cache_hits: number;
  total_ai_calls: number;
}
