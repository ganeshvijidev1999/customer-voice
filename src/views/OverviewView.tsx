import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';
import { ArrowRight, Upload, FileText } from 'lucide-react';
import {
  sentimentTextClass,
  severityTextClass,
  evidenceTextClass,
  priorityTextClass,
} from '../lib/api';
import type { DashboardMetrics, RuntimeStatus } from '../../shared/types';

interface OverviewViewProps {
  metrics: DashboardMetrics | null;
  runtime: RuntimeStatus | null;
  loading: boolean;
  onNavigate: (tab: string, focusId?: string) => void;
}

const SENTIMENT_BAR_COLORS: Record<string, string> = {
  Positive: '#16A34A',
  Negative: '#DC2626',
  Neutral: '#64748B',
  Mixed: '#D97706',
  Uncertain: '#6366F1',
};

export const OverviewView: React.FC<OverviewViewProps> = ({
  metrics,
  loading,
  onNavigate,
}) => {
  if (loading && !metrics) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-24 bg-white border border-slate-200 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 bg-white border border-slate-200 rounded-lg" />
          <div className="lg:col-span-5 h-72 bg-white border border-slate-200 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const { summary, workspace } = metrics;
  const isEmpty = summary.total_feedback === 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500 mb-1">
            <span>{workspace.company_name}</span>
            <span aria-hidden="true">·</span>
            <span>{workspace.industry}</span>
            <span aria-hidden="true">·</span>
            <span>Goal: {workspace.primary_objective}</span>
            {workspace.is_demo && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-indigo-700 font-medium">Illustrative Demo Dataset (100 sample records)</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Executive Customer Intelligence
          </h1>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>Executive Report</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('inbox')}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Ingest Feedback</span>
          </button>
        </div>
      </div>

      {/* Empty Workspace Onboarding State */}
      {isEmpty ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center max-w-2xl mx-auto">
          <h2 className="text-lg font-semibold text-slate-900">
            This workspace has no customer feedback yet
          </h2>
          <p className="text-sm text-slate-600 mt-2 max-w-lg mx-auto leading-relaxed">
            Follow the Listen → Understand → Prioritise → Act workflow. Upload a CSV export, paste raw interviews, or enter feedback manually to generate evidence-backed themes and RICE opportunities.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('inbox')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              <span>Upload CSV or Enter Feedback</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Unified 4-Column KPI Strip (single elevation, hairline dividers, zero nested cards) */}
          <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            <button
              type="button"
              onClick={() => onNavigate('inbox')}
              className="p-5 text-left hover:bg-slate-50/70 transition-colors"
            >
              <div className="text-xs text-slate-500">Total Feedback Records</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {summary.total_feedback}
              </div>
              <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
                {summary.analyzed_feedback} analyzed · {summary.pending_feedback} pending
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('explorer')}
              className="p-5 text-left hover:bg-slate-50/70 transition-colors"
            >
              <div className="text-xs text-slate-500">Major Pain Point Themes</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {summary.major_themes}
              </div>
              <div className="mt-1.5 text-xs tabular-nums">
                <span className="text-red-700 font-medium">{summary.high_severity_themes} High severity</span>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-500">{summary.identified_issues} issues</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('churn')}
              className="p-5 text-left hover:bg-slate-50/70 transition-colors"
            >
              <div className="text-xs text-slate-500">Potential Churn Signals</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {summary.potential_churn_signals}
              </div>
              <div className="mt-1.5 text-xs tabular-nums">
                <span className="text-red-700 font-medium">{summary.high_concern_churn} High concern</span>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-500">Evidence-flagged</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('actions')}
              className="p-5 text-left hover:bg-slate-50/70 transition-colors"
            >
              <div className="text-xs text-slate-500">Opportunities & Action Plans</div>
              <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {summary.prioritised_opportunities}
                <span className="text-base font-normal text-slate-400"> / {summary.active_action_plans + summary.completed_action_plans}</span>
              </div>
              <div className="mt-1.5 text-xs tabular-nums text-slate-500">
                {summary.active_action_plans} active · {summary.completed_action_plans} completed
              </div>
            </button>
          </div>

          {/* Primary Analytics Row: Feedback Volume Trend + Sentiment Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Feedback Volume Trend</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Total records vs. negative and positive volume across reporting windows
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                  <span className="text-blue-700 font-medium">Total</span>
                  <span>·</span>
                  <span className="text-red-700 font-medium">Negative</span>
                  <span>·</span>
                  <span className="text-emerald-700 font-medium">Positive</span>
                </div>
              </div>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metrics.volume_trend} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#E2E8F0',
                        borderRadius: '8px',
                        fontSize: '12px',
                        boxShadow: '0 4px 12px rgba(15,23,42,0.06)',
                      }}
                    />
                    <Area type="monotone" dataKey="total" name="Total Records" stroke="#2563EB" fill="#DBEAFE" fillOpacity={0.5} strokeWidth={2} />
                    <Area type="monotone" dataKey="negative" name="Negative" stroke="#DC2626" fill="#FEE2E2" fillOpacity={0.35} strokeWidth={1.75} />
                    <Area type="monotone" dataKey="positive" name="Positive" stroke="#16A34A" fill="#DCFCE7" fillOpacity={0.3} strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-baseline justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Sentiment Distribution</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Scored independently of business severity
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('sentiment')}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                  >
                    Inspect matrix
                  </button>
                </div>

                <div className="space-y-3.5 mt-2">
                  {metrics.sentiment_distribution.map((row) => (
                    <div key={row.sentiment}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className={sentimentTextClass(row.sentiment)}>{row.sentiment}</span>
                        <span className="font-mono tabular-nums text-slate-600">
                          {row.count} <span className="text-slate-400">({row.percentage}%)</span>
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-all duration-300"
                          style={{
                            width: `${Math.max(row.percentage, row.count > 0 ? 2 : 0)}%`,
                            backgroundColor: SENTIMENT_BAR_COLORS[row.sentiment] || '#64748B',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 pt-3.5 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500">
                <span>Human correction rate</span>
                <span className="font-mono tabular-nums font-medium text-slate-800">
                  {summary.human_correction_rate_pct}%
                </span>
              </div>
            </div>
          </div>

          {/* Secondary Analytics Row: Segment Comparison + Source Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Customer Segment Comparison</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Total feedback, high-severity issues, and potential churn signals by segment
                  </p>
                </div>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.segment_comparison} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="segment" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#E2E8F0',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="total" name="Total Records" fill="#2563EB" radius={[3, 3, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="high_severity" name="High Severity" fill="#6366F1" radius={[3, 3, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="churn_signals" name="Potential Churn Signals" fill="#DC2626" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-slate-900">Feedback Source Distribution</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Channel volume and negative feedback concentration
              </p>
              <div className="divide-y divide-slate-100">
                {metrics.source_distribution.map((src) => {
                  const negPct = src.count > 0 ? Math.round((src.negative_count / src.count) * 100) : 0;
                  return (
                    <div key={src.source} className="py-2.5 flex items-center justify-between text-xs gap-4">
                      <span className="font-medium text-slate-800 truncate">{src.source}</span>
                      <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
                        <span className="text-slate-500">{negPct}% neg</span>
                        <span className="font-semibold text-slate-900 w-8 text-right">{src.count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Top Pain Point Themes Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Top Evidence-Backed Pain Points</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any theme to open the 7-question investigation panel and inspect verbatim customer quotes
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('explorer')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
              >
                <span>Explore all themes</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-5">Pain Point Theme</th>
                    <th className="py-2.5 px-4 text-right">Records</th>
                    <th className="py-2.5 px-4">Severity</th>
                    <th className="py-2.5 px-4">Evidence</th>
                    <th className="py-2.5 px-4">Affected Segments</th>
                    <th className="py-2.5 px-5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {metrics.top_pain_points.map((theme) => (
                    <tr
                      key={theme.id}
                      onClick={() => onNavigate('explorer', theme.id)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{theme.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{theme.description}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">
                        {theme.frequency}
                      </td>
                      <td className={`py-3 px-4 text-xs whitespace-nowrap ${severityTextClass(theme.severity)}`}>
                        {theme.severity}
                      </td>
                      <td className={`py-3 px-4 text-xs whitespace-nowrap ${evidenceTextClass(theme.evidence_strength)}`}>
                        {theme.evidence_strength}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {theme.affected_segments.join(', ') || 'General'}
                      </td>
                      <td className="py-3 px-5 text-right text-xs text-slate-500 whitespace-nowrap">
                        {theme.review_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Decision Grid: Emerging Trends & Recommended Next Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-slate-900">Emerging Issues (Last 30 Days)</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Themes showing active recent velocity across workspace timestamps
              </p>
              <div className="divide-y divide-slate-100">
                {metrics.emerging_issues.map((item) => (
                  <button
                    key={item.theme_id}
                    type="button"
                    onClick={() => onNavigate('explorer', item.theme_id)}
                    className="w-full py-3 text-left hover:bg-slate-50/70 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 truncate">{item.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                        <span className={severityTextClass(item.severity)}>{item.severity}</span>
                        <span>·</span>
                        <span className={evidenceTextClass(item.evidence_strength)}>{item.evidence_strength} evidence</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                        {item.recent_count} recent
                      </div>
                      <div className="text-[11px] text-indigo-700 font-medium">{item.growth_label}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Prioritised Recommended Actions</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ranked by live RICE score — click to adjust scoring or convert to an action plan
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('prioritisation')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  <span>Open RICE Engine</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {metrics.recommended_actions.map((opp, index) => (
                  <div
                    key={opp.id}
                    onClick={() => onNavigate('prioritisation', opp.id)}
                    className="py-3 flex items-start justify-between gap-4 hover:bg-slate-50/70 cursor-pointer transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-0.5">
                        <span className="font-mono tabular-nums text-slate-400">0{index + 1}.</span>
                        <span className={priorityTextClass(opp.priority)}>{opp.priority}</span>
                        <span>·</span>
                        <span>{opp.evidence_count || 0} linked quotes</span>
                        <span>·</span>
                        <span>{opp.status}</span>
                      </div>
                      <div className="text-sm font-medium text-slate-900">{opp.title}</div>
                      <div className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                        Next step: {opp.recommended_next_action}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-slate-400">RICE</div>
                      <div className="text-base font-bold font-mono tabular-nums text-blue-700">
                        {opp.rice_score}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
