import { db } from './db.ts';
import type {
  DashboardMetrics,
  Workspace,
  PainPointTheme,
  Opportunity,
  SentimentType,
  SeverityLevel,
  EvidenceRecord,
  ActionPlan,
} from '../shared/types.ts';

function parseJsonArray<T>(val: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function getWorkspaceThemesWithEvidence(workspaceId: string): PainPointTheme[] {
  const themeRows = db
    .prepare(
      `SELECT * FROM pain_point_themes WHERE workspace_id = ?
       ORDER BY CASE severity WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, frequency DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const evidenceRows = db
    .prepare(
      `SELECT e.*, f.feedback_id, f.source, f.feedback_date, f.customer_segment, f.customer_id, f.sentiment, f.severity
       FROM evidence_records e
       JOIN feedback_records f ON f.id = e.feedback_record_id
       WHERE e.workspace_id = ?
       ORDER BY f.feedback_date DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const evidenceByTheme = new Map<string, EvidenceRecord[]>();
  for (const row of evidenceRows) {
    const tid = String(row.theme_id);
    const list = evidenceByTheme.get(tid) || [];
    list.push({
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      feedback_record_id: String(row.feedback_record_id),
      theme_id: tid,
      original_quote: String(row.original_quote),
      confidence: Number(row.confidence || 0),
      created_at: String(row.created_at),
      feedback_id: String(row.feedback_id || ''),
      source: String(row.source || ''),
      feedback_date: String(row.feedback_date || ''),
      customer_segment: String(row.customer_segment || ''),
      customer_id: row.customer_id ? String(row.customer_id) : null,
      sentiment: (row.sentiment as SentimentType) || null,
      severity: (row.severity as SeverityLevel) || null,
    });
    evidenceByTheme.set(tid, list);
  }

  return themeRows.map((t) => {
    const id = String(t.id);
    const ev = evidenceByTheme.get(id) || [];
    return {
      id,
      workspace_id: String(t.workspace_id),
      title: String(t.title),
      description: String(t.description),
      why_happening: String(t.why_happening || ''),
      next_investigation: String(t.next_investigation || ''),
      frequency: ev.length > 0 ? ev.length : Number(t.frequency || 0),
      severity: (t.severity as SeverityLevel) || 'Medium',
      severity_reasoning: String(t.severity_reasoning || ''),
      sentiment: (t.sentiment as SentimentType) || 'Negative',
      affected_segments: parseJsonArray<string>(t.affected_segments),
      first_reported_date: t.first_reported_date ? String(t.first_reported_date) : null,
      latest_reported_date: t.latest_reported_date ? String(t.latest_reported_date) : null,
      trend_summary: String(t.trend_summary || ''),
      confidence: Number(t.confidence || 0.75),
      evidence_strength: (t.evidence_strength as PainPointTheme['evidence_strength']) || 'Insufficient',
      review_status: (t.review_status as PainPointTheme['review_status']) || 'Needs Review',
      human_corrected: Boolean(t.human_corrected),
      created_at: String(t.created_at),
      updated_at: String(t.updated_at),
      evidence: ev,
    };
  });
}

export function getWorkspaceOpportunities(workspaceId: string): Opportunity[] {
  const rows = db
    .prepare(
      `SELECT o.*, t.title as theme_title
       FROM opportunities o
       LEFT JOIN pain_point_themes t ON t.id = o.theme_id
       WHERE o.workspace_id = ?
       ORDER BY o.rice_score DESC, o.created_at DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const themes = getWorkspaceThemesWithEvidence(workspaceId);
  const themeMap = new Map(themes.map((t) => [t.id, t]));

  return rows.map((r) => {
    const theme = r.theme_id ? themeMap.get(String(r.theme_id)) : undefined;
    const ev = theme?.evidence || [];
    return {
      id: String(r.id),
      workspace_id: String(r.workspace_id),
      theme_id: r.theme_id ? String(r.theme_id) : null,
      theme_title: r.theme_title ? String(r.theme_title) : null,
      title: String(r.title),
      problem_statement: String(r.problem_statement),
      customer_impact: String(r.customer_impact || ''),
      business_impact: String(r.business_impact || ''),
      proposed_solution: String(r.proposed_solution || ''),
      recommended_next_action: String(r.recommended_next_action || ''),
      assumptions: parseJsonArray<string>(r.assumptions),
      risks: parseJsonArray<string>(r.risks),
      reach: Number(r.reach || 100),
      impact: Number(r.impact || 1),
      confidence: Number(r.confidence || 70),
      effort: Number(r.effort || 2),
      rice_score: Number(r.rice_score || 0),
      priority: (r.priority as Opportunity['priority']) || 'P2 - Medium',
      recommendation: String(r.recommendation || ''),
      status: (r.status as Opportunity['status']) || 'Proposed',
      evidence_count: ev.length,
      sample_quotes: ev.slice(0, 3).map((e) => ({
        feedback_id: e.feedback_id || '',
        original_quote: e.original_quote,
        customer_segment: e.customer_segment || 'General',
        source: e.source || 'Unknown',
        feedback_date: e.feedback_date || '',
      })),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  });
}

export function getWorkspaceActionPlans(workspaceId: string): ActionPlan[] {
  const rows = db
    .prepare(
      `SELECT a.*, o.title as opportunity_title
       FROM action_plans a
       LEFT JOIN opportunities o ON o.id = a.opportunity_id
       WHERE a.workspace_id = ?
       ORDER BY CASE a.status WHEN 'In progress' THEN 1 WHEN 'Not started' THEN 2 ELSE 3 END, a.created_at DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    opportunity_id: r.opportunity_id ? String(r.opportunity_id) : null,
    opportunity_title: r.opportunity_title ? String(r.opportunity_title) : null,
    title: String(r.title),
    problem_statement: String(r.problem_statement || ''),
    evidence_summary: String(r.evidence_summary || ''),
    description: String(r.description || ''),
    expected_impact: String(r.expected_impact || ''),
    owner: String(r.owner || 'Unassigned'),
    priority: (r.priority as ActionPlan['priority']) || 'P1 - High',
    status: (r.status as ActionPlan['status']) || 'Not started',
    next_steps: parseJsonArray<string>(r.next_steps),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }));
}

export function computeDashboardMetrics(workspace: Workspace): DashboardMetrics {
  const feedbackRows = db
    .prepare(`SELECT * FROM feedback_records WHERE workspace_id = ? ORDER BY feedback_date ASC`)
    .all(workspace.id) as Array<Record<string, unknown>>;

  const themes = getWorkspaceThemesWithEvidence(workspace.id);
  const opportunities = getWorkspaceOpportunities(workspace.id);
  const actions = getWorkspaceActionPlans(workspace.id);

  const totalFeedback = feedbackRows.length;
  const analyzedFeedback = feedbackRows.filter((f) => f.processing_status === 'completed').length;
  const pendingFeedback = feedbackRows.filter((f) => f.processing_status !== 'completed').length;
  const identifiedIssues = feedbackRows.filter(
    (f) => f.theme_id !== null || f.sentiment === 'Negative' || f.severity === 'High'
  ).length;

  const churnRows = feedbackRows.filter((f) => Boolean(f.churn_signal));
  const highConcernChurn = churnRows.filter((f) => f.churn_concern_level === 'High').length;
  const negativeCount = feedbackRows.filter((f) => f.sentiment === 'Negative').length;
  const positiveCount = feedbackRows.filter((f) => f.sentiment === 'Positive').length;
  const humanCorrectedCount =
    feedbackRows.filter((f) => Boolean(f.human_corrected)).length +
    themes.filter((t) => t.human_corrected).length;
  const totalReviewable = Math.max(1, analyzedFeedback + themes.length);

  // 1. Feedback Volume Trend (grouped by ISO week or month depending on span)
  const bucketMap = new Map<string, { period: string; total: number; negative: number; positive: number; neutral_mixed: number }>();
  for (const r of feedbackRows) {
    const rawDate = String(r.feedback_date || '').slice(0, 10);
    // Group into bi-weekly labels (e.g. "Aug W2", "Sep W1" etc.) for crisp readable timeline
    const d = new Date(rawDate + 'T00:00:00Z');
    let label = rawDate.slice(0, 7) || 'Unknown';
    let sortKey = label;
    if (!Number.isNaN(d.getTime())) {
      const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const half = d.getUTCDate() <= 15 ? '1' : '2';
      label = `${month} ${half === '1' ? '1–15' : '16–31'}`;
      sortKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${half}`;
    }
    const existing = bucketMap.get(sortKey) || {
      period: label,
      total: 0,
      negative: 0,
      positive: 0,
      neutral_mixed: 0,
    };
    existing.total++;
    if (r.sentiment === 'Negative') existing.negative++;
    else if (r.sentiment === 'Positive') existing.positive++;
    else existing.neutral_mixed++;
    bucketMap.set(sortKey, existing);
  }
  const volume_trend = Array.from(bucketMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, val]) => val);

  // 2. Sentiment Distribution
  const allSentiments: SentimentType[] = ['Positive', 'Negative', 'Neutral', 'Mixed', 'Uncertain'];
  const sentiment_distribution = allSentiments.map((s) => {
    const count = feedbackRows.filter((f) => f.sentiment === s).length;
    return {
      sentiment: s,
      count,
      percentage: totalFeedback > 0 ? Number(((count / totalFeedback) * 100).toFixed(1)) : 0,
    };
  });

  // 3. Feedback Source Distribution
  const sourceMap = new Map<string, { source: string; count: number; negative_count: number }>();
  for (const r of feedbackRows) {
    const src = String(r.source || 'Manual Entry');
    const cur = sourceMap.get(src) || { source: src, count: 0, negative_count: 0 };
    cur.count++;
    if (r.sentiment === 'Negative') cur.negative_count++;
    sourceMap.set(src, cur);
  }
  const source_distribution = Array.from(sourceMap.values()).sort((a, b) => b.count - a.count);

  // 4. Customer Segment Comparison
  const segMap = new Map<
    string,
    { segment: string; total: number; negative: number; high_severity: number; churn_signals: number }
  >();
  for (const r of feedbackRows) {
    const seg = String(r.customer_segment || 'General');
    const cur = segMap.get(seg) || { segment: seg, total: 0, negative: 0, high_severity: 0, churn_signals: 0 };
    cur.total++;
    if (r.sentiment === 'Negative') cur.negative++;
    if (r.severity === 'High') cur.high_severity++;
    if (r.churn_signal) cur.churn_signals++;
    segMap.set(seg, cur);
  }
  const segment_comparison = Array.from(segMap.values()).sort((a, b) => b.total - a.total);

  // 5. Product Area Breakdown
  const areaMap = new Map<
    string,
    { product_area: string; total: number; negative: number; positive: number; high_severity: number }
  >();
  for (const r of feedbackRows) {
    const area = String(r.product_area || 'General');
    const cur = areaMap.get(area) || { product_area: area, total: 0, negative: 0, positive: 0, high_severity: 0 };
    cur.total++;
    if (r.sentiment === 'Negative') cur.negative++;
    if (r.sentiment === 'Positive') cur.positive++;
    if (r.severity === 'High') cur.high_severity++;
    areaMap.set(area, cur);
  }
  const product_area_breakdown = Array.from(areaMap.values()).sort((a, b) => b.total - a.total);

  // 6. Sentiment vs Severity Separation Matrix (explicitly proves negative != high severity)
  const sentiment_vs_severity = allSentiments.map((s) => {
    const subset = feedbackRows.filter((f) => f.sentiment === s);
    return {
      sentiment: s,
      low: subset.filter((f) => f.severity === 'Low').length,
      medium: subset.filter((f) => f.severity === 'Medium').length,
      high: subset.filter((f) => f.severity === 'High').length,
    };
  });

  // 7. Emerging Issues (comparing latest 30 days vs prior period based on actual feedback dates)
  const allDates = feedbackRows.map((r) => String(r.feedback_date || '')).filter(Boolean).sort();
  const maxDateStr = allDates[allDates.length - 1] || new Date().toISOString().slice(0, 10);
  const maxDateMs = new Date(maxDateStr + 'T00:00:00Z').getTime();
  const cutoff30d = new Date(maxDateMs - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const emerging_issues = themes
    .map((t) => {
      const ev = t.evidence || [];
      const recentCount = ev.filter((e) => (e.feedback_date || '') >= cutoff30d).length;
      const priorCount = ev.filter((e) => (e.feedback_date || '') < cutoff30d).length;
      let growth_label = 'Steady';
      if (priorCount === 0 && recentCount > 0) growth_label = 'New in last 30d';
      else if (recentCount > priorCount) {
        const pct = Math.round(((recentCount - priorCount) / Math.max(1, priorCount)) * 100);
        growth_label = `+${pct}% vs prior period`;
      } else if (recentCount === 0) {
        growth_label = 'Cooling';
      } else {
        growth_label = `${recentCount} reports in last 30d`;
      }
      return {
        theme_id: t.id,
        title: t.title,
        recent_count: recentCount,
        prior_count: priorCount,
        growth_label,
        severity: t.severity,
        evidence_strength: t.evidence_strength,
      };
    })
    .sort((a, b) => b.recent_count - a.recent_count)
    .slice(0, 5);

  // 8. Critical Insights derived dynamically from high-severity themes + opportunities
  const critical_insights = themes
    .filter((t) => t.severity === 'High')
    .slice(0, 4)
    .map((t) => {
      const linkedOpp = opportunities.find((o) => o.theme_id === t.id);
      return {
        id: t.id,
        title: t.title,
        category: t.affected_segments.join(', ') || 'All segments',
        severity: t.severity,
        evidence_count: t.frequency,
        summary: t.severity_reasoning || t.description,
        recommended_action: linkedOpp?.recommended_next_action || t.next_investigation,
      };
    });

  return {
    workspace,
    summary: {
      total_feedback: totalFeedback,
      analyzed_feedback: analyzedFeedback,
      pending_feedback: pendingFeedback,
      identified_issues: identifiedIssues,
      major_themes: themes.length,
      high_severity_themes: themes.filter((t) => t.severity === 'High').length,
      potential_churn_signals: churnRows.length,
      high_concern_churn: highConcernChurn,
      prioritised_opportunities: opportunities.length,
      active_action_plans: actions.filter((a) => a.status !== 'Completed').length,
      completed_action_plans: actions.filter((a) => a.status === 'Completed').length,
      negative_share_pct: totalFeedback > 0 ? Number(((negativeCount / totalFeedback) * 100).toFixed(1)) : 0,
      positive_share_pct: totalFeedback > 0 ? Number(((positiveCount / totalFeedback) * 100).toFixed(1)) : 0,
      human_correction_rate_pct: Number(((humanCorrectedCount / totalReviewable) * 100).toFixed(1)),
    },
    volume_trend,
    sentiment_distribution,
    source_distribution,
    segment_comparison,
    product_area_breakdown,
    sentiment_vs_severity,
    top_pain_points: themes.slice(0, 6),
    emerging_issues,
    critical_insights,
    recommended_actions: opportunities.slice(0, 5),
  };
}
