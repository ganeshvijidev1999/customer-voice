import React, { useEffect, useState, useCallback } from 'react';
import { Printer, Download, RefreshCw } from 'lucide-react';
import {
  apiRequest,
  severityTextClass,
  sentimentTextClass,
  evidenceTextClass,
  priorityTextClass,
  actionStatusTextClass,
  formatShortDate,
} from '../lib/api';
import type {
  Workspace,
  DashboardMetrics,
  PainPointTheme,
  Opportunity,
  ActionPlan,
} from '../../shared/types';

interface ReportPayload {
  generated_at: string;
  workspace: Workspace;
  metrics: DashboardMetrics;
  themes: PainPointTheme[];
  opportunities: Opportunity[];
  action_plans: ActionPlan[];
  churn_signals: Array<{
    id: string;
    feedback_id: string;
    customer_id: string | null;
    customer_segment: string;
    source: string;
    feedback_date: string;
    customer_text: string;
    churn_signal_type: string | null;
    churn_concern_level: string | null;
    churn_reasoning: string | null;
    churn_followup: string | null;
    churn_status: string;
  }>;
  limitations: string[];
}

interface ReportsViewProps {
  workspaceId: string;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ workspaceId }) => {
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<ReportPayload>(`/api/workspaces/${workspaceId}/report`);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate executive report.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function exportMarkdownBrief() {
    if (!report) return;
    const { workspace, metrics, themes, opportunities, action_plans, churn_signals, limitations } = report;
    const lines: string[] = [
      `# Voice of Customer Executive Report — ${workspace.company_name}`,
      `Generated: ${new Date(report.generated_at).toUTCString()}`,
      `Industry: ${workspace.industry} | Objective: ${workspace.primary_objective}`,
      workspace.is_demo ? `> Note: Generated from Illustrative Demo Dataset (100 sample records).` : '',
      '',
      `## 1. Executive Summary`,
      `- Total Feedback Records: ${metrics.summary.total_feedback} (${metrics.summary.analyzed_feedback} analyzed)`,
      `- Major Pain Point Themes: ${metrics.summary.major_themes} (${metrics.summary.high_severity_themes} High Severity)`,
      `- Potential Churn Signals: ${metrics.summary.potential_churn_signals} (${metrics.summary.high_concern_churn} High Concern)`,
      `- Prioritised Opportunities: ${metrics.summary.prioritised_opportunities} | Active Action Plans: ${metrics.summary.active_action_plans}`,
      '',
      `## 2. Major Customer Problems`,
      ...themes.map(
        (t, i) =>
          `${i + 1}. **${t.title}** (${t.severity} severity · ${t.frequency} records · ${t.evidence_strength} evidence)\n   - ${t.description}`
      ),
      '',
      `## 3. Prioritised Opportunities (Current RICE Rankings)`,
      ...opportunities.map(
        (o, i) =>
          `${i + 1}. **${o.title}** — RICE ${o.rice_score} (${o.priority} | R:${o.reach} I:${o.impact} C:${o.confidence}% E:${o.effort}w)\n   - Recommended Next Action: ${o.recommended_next_action}`
      ),
      '',
      `## 4. Potential Churn Signals (Evidence-Based, Non-Predictive)`,
      ...churn_signals.slice(0, 8).map(
        (c) =>
          `- [${c.feedback_id} / ${c.customer_id || 'Account'}] ${c.churn_signal_type} (${c.churn_concern_level} concern): "${c.customer_text}"`
      ),
      '',
      `## 5. Recommended Action Plans`,
      ...action_plans.map(
        (a) => `- [${a.status}] **${a.title}** (Owner: ${a.owner} | ${a.priority}) — ${a.description}`
      ),
      '',
      `## 6. Risks & Limitations`,
      ...limitations.map((l) => `- ${l}`),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workspace.company_name.toLowerCase().replace(/\s+/g, '-')}-voc-executive-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !report) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-xs text-slate-500">
        Compiling live executive report from workspace data...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="bg-white border border-red-200 rounded-lg p-8 text-center text-xs text-red-700">
        {error || 'Unable to load executive report.'}
      </div>
    );
  }

  const { workspace, metrics, themes, opportunities, action_plans, churn_signals, limitations } = report;
  const topHighThemes = themes.filter((t) => t.severity === 'High');

  return (
    <div className="space-y-6">
      {/* Screen-only Action Toolbar */}
      <div className="no-print flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Executive Report Generator</h1>
          <p className="text-sm text-slate-600 mt-1">
            Generated live from stored workspace records and current RICE scores. Print or save as PDF directly from your browser.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => loadReport()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Live Data</span>
          </button>
          <button
            type="button"
            onClick={exportMarkdownBrief}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Markdown</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save as PDF</span>
          </button>
        </div>
      </div>

      {/* Printable Executive Document */}
      <article className="bg-white border border-slate-200 rounded-lg p-7 sm:p-10 space-y-8 max-w-5xl print:border-none print:p-0 print:max-w-none">
        {/* Report Title Header */}
        <header className="pb-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-blue-700 mb-1">
              Voice of Customer Copilot · Executive Decision Brief
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {workspace.company_name} — Customer Intelligence & Roadmap Report
            </h2>
            <div className="mt-2 flex items-center flex-wrap gap-2 text-xs text-slate-500">
              <span>Industry: {workspace.industry}</span>
              <span>·</span>
              <span>Model: {workspace.business_type}</span>
              <span>·</span>
              <span>Objective: {workspace.primary_objective}</span>
              {workspace.is_demo && (
                <>
                  <span>·</span>
                  <span className="text-indigo-700 font-medium">Illustrative Demo Dataset</span>
                </>
              )}
            </div>
          </div>
          <div className="text-xs text-slate-500 font-mono sm:text-right shrink-0">
            <div>Generated {formatShortDate(report.generated_at)}</div>
            <div>{metrics.summary.total_feedback} stored records</div>
          </div>
        </header>

        {/* Section 1: Executive Summary */}
        <section className="space-y-3 print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-900">01. Executive Summary</h3>
          <p className="text-sm text-slate-700 leading-relaxed">
            Across <span className="font-mono font-semibold text-slate-900">{metrics.summary.total_feedback}</span> stored customer feedback records in the{' '}
            <span className="font-semibold text-slate-900">{workspace.company_name}</span> workspace,{' '}
            <span className="font-mono font-semibold text-slate-900">{metrics.summary.major_themes}</span> evidence-backed pain point themes were identified, including{' '}
            <span className="font-mono font-semibold text-red-700">{topHighThemes.length}</span> high-severity product or service issues.{' '}
            {topHighThemes.length > 0 && (
              <>
                The most urgent customer friction centers on{' '}
                <span className="font-medium text-slate-900">
                  {topHighThemes.slice(0, 3).map((t) => t.title).join('; ')}
                </span>
                .{' '}
              </>
            )}
            Evidence review also surfaced{' '}
            <span className="font-mono font-semibold text-slate-900">{churn_signals.length}</span> potential churn signals (
            {metrics.summary.high_concern_churn} high concern) requiring coordinated Product and Customer Success follow-up.
            {opportunities.length > 0 && (
              <>
                {' '}Based on current live RICE prioritisation, the top-ranked opportunity is{' '}
                <span className="font-semibold text-slate-900">{opportunities[0].title}</span> (RICE{' '}
                <span className="font-mono">{opportunities[0].rice_score}</span>).
              </>
            )}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-3.5">
              <div className="text-[11px] text-slate-500">Feedback Records</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {metrics.summary.total_feedback}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-[11px] text-slate-500">High-Severity Themes</div>
              <div className="text-lg font-bold font-mono tabular-nums text-red-700 mt-0.5">
                {metrics.summary.high_severity_themes}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-[11px] text-slate-500">Potential Churn Signals</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {metrics.summary.potential_churn_signals}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-[11px] text-slate-500">Active / Done Actions</div>
              <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-0.5">
                {metrics.summary.active_action_plans} / {metrics.summary.completed_action_plans}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Feedback Overview */}
        <section className="space-y-3 print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-900">02. Feedback Overview by Channel & Segment</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">Source Channels</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 text-left font-medium">Source</th>
                    <th className="py-1.5 text-right font-medium">Records</th>
                    <th className="py-1.5 text-right font-medium">Negative</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metrics.source_distribution.map((s) => (
                    <tr key={s.source}>
                      <td className="py-1.5 text-slate-800">{s.source}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{s.count}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-slate-500">{s.negative_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">Customer Segments</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 text-left font-medium">Segment</th>
                    <th className="py-1.5 text-right font-medium">Total</th>
                    <th className="py-1.5 text-right font-medium">High Sev</th>
                    <th className="py-1.5 text-right font-medium">Churn Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metrics.segment_comparison.map((s) => (
                    <tr key={s.segment}>
                      <td className="py-1.5 text-slate-800">{s.segment}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{s.total}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{s.high_severity}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-red-700">{s.churn_signals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Section 3: Major Customer Problems */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900">03. Major Customer Problems</h3>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2 px-3.5 font-semibold">Pain Point Theme</th>
                  <th className="py-2 px-3 text-right font-semibold">Records</th>
                  <th className="py-2 px-3 font-semibold">Severity</th>
                  <th className="py-2 px-3 font-semibold">Evidence</th>
                  <th className="py-2 px-3.5 font-semibold">Segments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {themes.map((t) => (
                  <tr key={t.id} className="print-break-inside-avoid">
                    <td className="py-2.5 px-3.5">
                      <div className="font-semibold text-slate-900">{t.title}</div>
                      <div className="text-slate-600 mt-0.5">{t.description}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">{t.frequency}</td>
                    <td className={`py-2.5 px-3 whitespace-nowrap ${severityTextClass(t.severity)}`}>{t.severity}</td>
                    <td className={`py-2.5 px-3 whitespace-nowrap ${evidenceTextClass(t.evidence_strength)}`}>
                      {t.evidence_strength}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-600">{t.affected_segments.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: Sentiment Trends */}
        <section className="space-y-3 print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-900">04. Sentiment Trends & Severity Separation</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            {metrics.sentiment_distribution.map((row) => (
              <div key={row.sentiment} className="p-3 border border-slate-200 rounded-lg">
                <div className={sentimentTextClass(row.sentiment)}>{row.sentiment}</div>
                <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-1">{row.count}</div>
                <div className="font-mono text-slate-500">{row.percentage}%</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Severity is assessed independently of emotional tone. Calm or mixed operational reports (such as silent data export truncation) retain High severity, while emphatic cosmetic requests remain Low severity.
          </p>
        </section>

        {/* Section 5: Potential Churn Signals */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900">05. Potential Churn Signals (Non-Predictive Evidence)</h3>
          {churn_signals.length === 0 ? (
            <p className="text-xs text-slate-500">No potential churn signals currently flagged in this workspace.</p>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
              {churn_signals.slice(0, 8).map((c) => (
                <div key={c.id} className="p-3.5 print-break-inside-avoid">
                  <div className="flex items-center flex-wrap gap-2 text-slate-500 mb-1">
                    <span className="font-mono font-semibold text-slate-900">{c.customer_id || c.feedback_id}</span>
                    <span>·</span>
                    <span className="text-red-700 font-medium">Potential churn signal</span>
                    <span>·</span>
                    <span>{c.churn_signal_type}</span>
                    <span>·</span>
                    <span className={severityTextClass(c.churn_concern_level as 'High' | 'Medium' | 'Low')}>
                      {c.churn_concern_level} concern
                    </span>
                    <span>·</span>
                    <span>{c.customer_segment}</span>
                  </div>
                  <p className="text-slate-900">&ldquo;{c.customer_text}&rdquo;</p>
                  <p className="text-slate-600 mt-1">
                    <span className="font-medium text-slate-700">Suggested Follow-Up:</span> {c.churn_followup}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 6: Supporting Verbatim Customer Quotes */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900">06. Supporting Verbatim Customer Quotes</h3>
          <div className="space-y-3">
            {themes.slice(0, 5).map((theme) => (
              <div key={theme.id} className="border border-slate-200 rounded-lg p-4 print-break-inside-avoid">
                <div className="text-xs font-semibold text-slate-900 mb-2">
                  {theme.title} ({theme.evidence?.length || 0} linked records)
                </div>
                <div className="space-y-2 text-xs">
                  {(theme.evidence || []).slice(0, 2).map((ev) => (
                    <div key={ev.id} className="text-slate-700">
                      <span>&ldquo;{ev.original_quote}&rdquo;</span>
                      <span className="ml-2 font-mono text-[11px] text-slate-400">
                        — {ev.feedback_id}, {ev.customer_segment}, {ev.source}, {ev.feedback_date}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 7: Prioritised Opportunities */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900">07. Prioritised Product Opportunities (Live RICE Scores)</h3>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2 px-3 font-semibold">Rank</th>
                  <th className="py-2 px-3 font-semibold">Opportunity & Recommended Next Step</th>
                  <th className="py-2 px-3 text-right font-semibold">R / I / C / E</th>
                  <th className="py-2 px-3 text-right font-semibold">RICE</th>
                  <th className="py-2 px-3 font-semibold">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {opportunities.map((o, idx) => (
                  <tr key={o.id} className="print-break-inside-avoid">
                    <td className="py-2.5 px-3 font-mono text-slate-500">#{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{o.title}</div>
                      <div className="text-slate-600 mt-0.5">{o.recommended_next_action}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {o.reach} / {o.impact} / {o.confidence}% / {o.effort}w
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-blue-700">
                      {o.rice_score}
                    </td>
                    <td className={`py-2.5 px-3 whitespace-nowrap ${priorityTextClass(o.priority)}`}>{o.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 8: Recommended Action Plans */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900">08. Owned Action Plans</h3>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
            {action_plans.map((a) => (
              <div key={a.id} className="p-3.5 print-break-inside-avoid">
                <div className="flex items-center flex-wrap gap-2 text-slate-500 mb-1">
                  <span className={priorityTextClass(a.priority)}>{a.priority}</span>
                  <span>·</span>
                  <span className={actionStatusTextClass(a.status)}>{a.status}</span>
                  <span>·</span>
                  <span>Owner: <span className="font-medium text-slate-800">{a.owner}</span></span>
                </div>
                <div className="font-semibold text-slate-900 text-sm">{a.title}</div>
                <p className="text-slate-700 mt-1">{a.description}</p>
                {a.expected_impact && (
                  <p className="text-slate-500 mt-1">Expected Impact: {a.expected_impact}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Section 9: Risks & Limitations */}
        <section className="space-y-2 pt-4 border-t border-slate-200 print-break-inside-avoid">
          <h3 className="text-base font-bold text-slate-900">09. Risks, Assumptions & Data Limitations</h3>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 leading-relaxed">
            {limitations.map((lim, idx) => (
              <li key={idx}>{lim}</li>
            ))}
          </ul>
        </section>
      </article>
    </div>
  );
};
