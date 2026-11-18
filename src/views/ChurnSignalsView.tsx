import React, { useEffect, useState, useCallback } from 'react';
import { ArrowUpRight, Info } from 'lucide-react';
import { apiRequest, severityTextClass, formatShortDate } from '../lib/api';
import type { FeedbackRecord } from '../../shared/types';

interface ChurnSignalsViewProps {
  workspaceId: string;
  onDataChanged: () => void;
  onNavigate: (tab: string) => void;
}

export const ChurnSignalsView: React.FC<ChurnSignalsViewProps> = ({
  workspaceId,
  onDataChanged,
  onNavigate,
}) => {
  const [signals, setSignals] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [concernFilter, setConcernFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ records?: FeedbackRecord[] }>(
        `/api/workspaces/${workspaceId}/feedback?churn_only=true`
      );
      setSignals(Array.isArray(res?.records) ? res.records : []);
    } catch (err) {
      setSignals([]);
      setError(err instanceof Error ? err.message : 'Unable to load potential churn signals.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  async function updateChurnStatus(rec: FeedbackRecord, nextStatus: 'Open' | 'Investigating' | 'Addressed') {
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/feedback/${rec.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ churn_status: nextStatus }),
      });
      await loadSignals();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update signal status.');
    }
  }

  async function createActionFromSignal(rec: FeedbackRecord) {
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/action-plans`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Retention follow-up: ${rec.customer_id || rec.feedback_id} (${rec.churn_signal_type || 'Potential churn signal'})`,
          problem_statement: rec.churn_reasoning || rec.problem_description || rec.customer_text,
          evidence_summary: `${rec.feedback_id} (${rec.source}, ${rec.feedback_date}): "${rec.customer_text}"`,
          description: rec.churn_followup || 'Reach out directly to customer stakeholder and address root product friction.',
          expected_impact: `Mitigate documented retention concern in ${rec.customer_segment} segment.`,
          owner: 'Customer Success & PM',
          priority: rec.churn_concern_level === 'High' ? 'P0 - Critical' : 'P1 - High',
          status: 'Not started',
          next_steps: [
            rec.churn_followup || 'Contact account champion within 24 hours',
            'Audit open support tickets and product blockers linked to this account',
            'Confirm resolution and record follow-up outcome',
          ],
        }),
      });
      setNotice(`Created retention Action Plan for ${rec.customer_id || rec.feedback_id}.`);
      onDataChanged();
      onNavigate('actions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create retention action plan.');
    }
  }

  const signalTypes = Array.from(
    new Set(signals.map((s) => s.churn_signal_type).filter((x): x is string => Boolean(x)))
  );

  const filtered = signals.filter((s) => {
    if (concernFilter !== 'All' && s.churn_concern_level !== concernFilter) return false;
    if (typeFilter !== 'All' && s.churn_signal_type !== typeFilter) return false;
    if (statusFilter !== 'All' && s.churn_status !== statusFilter) return false;
    return true;
  });

  const highCount = signals.filter((s) => s.churn_concern_level === 'High').length;
  const openCount = signals.filter((s) => s.churn_status === 'Open').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Potential Churn Signals</h1>
        <p className="text-sm text-slate-600 mt-1">
          Evidence-backed customer feedback exhibiting cancellation language, repeated unresolved issues, pricing friction, or stalled onboarding.
        </p>
      </div>

      {/* Explicit Epistemic Boundary Notice (NOT a predictive churn probability model) */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5 flex items-start gap-3 text-xs text-slate-700">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <span className="font-semibold text-slate-900">Methodology Disclosure:</span> Each item below is labelled{' '}
          <span className="font-medium text-slate-900">&ldquo;Potential churn signal&rdquo;</span> based strictly on verifiable customer language and recurring service friction. This workbench does not fabricate statistical churn probabilities or claim an account will definitely leave.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div className="px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-900">
          {notice}
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Potential Churn Signals</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{signals.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">High Concern Level</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">{highCount}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Open (Awaiting Action)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">{openCount}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Signal Categories</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{signalTypes.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {['All', 'High', 'Medium', 'Low'].map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setConcernFilter(lvl)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                concernFilter === lvl ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {lvl === 'All' ? 'All Concern Levels' : `${lvl} Concern`}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
        >
          <option value="All">All Signal Types</option>
          {signalTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
        >
          <option value="All">All Follow-up Statuses</option>
          <option value="Open">Open</option>
          <option value="Investigating">Investigating</option>
          <option value="Addressed">Addressed</option>
        </select>
      </div>

      {/* Signal Evidence List */}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-xs text-slate-500">Loading potential churn signals...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No potential churn signals match the selected filter.
          </div>
        ) : (
          filtered.map((sig) => (
            <div key={sig.id} className="p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-900">
                    {sig.customer_id || 'Unidentified Customer'}
                  </span>
                  <span>·</span>
                  <span className="text-red-700 font-medium">Potential churn signal</span>
                  <span>·</span>
                  <span className="font-medium text-slate-800">{sig.churn_signal_type || 'Feedback risk signal'}</span>
                  <span>·</span>
                  <span className={severityTextClass(sig.churn_concern_level)}>
                    {sig.churn_concern_level || 'Medium'} concern
                  </span>
                  <span>·</span>
                  <span>{sig.customer_segment}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={sig.churn_status}
                    onChange={(e) =>
                      updateChurnStatus(sig, e.target.value as 'Open' | 'Investigating' | 'Addressed')
                    }
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-medium text-slate-700"
                  >
                    <option value="Open">Open</option>
                    <option value="Investigating">Investigating</option>
                    <option value="Addressed">Addressed</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => createActionFromSignal(sig)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap"
                  >
                    <span>Create Action Plan</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Exact Verbatim Quote */}
              <div className="p-3.5 bg-slate-50/80 border border-slate-200/80 rounded-lg">
                <p className="text-sm text-slate-900 leading-relaxed">&ldquo;{sig.customer_text}&rdquo;</p>
                <div className="mt-1.5 text-[11px] text-slate-500 font-mono">
                  {sig.feedback_id} · {sig.source} · {formatShortDate(sig.feedback_date)} · {sig.product_area}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
                <div>
                  <span className="font-semibold text-slate-700">Evidence Reasoning: </span>
                  <span className="text-slate-600 leading-relaxed">
                    {sig.churn_reasoning || sig.severity_reasoning || 'Flagged from customer feedback language.'}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Suggested Follow-Up Action: </span>
                  <span className="text-slate-800 leading-relaxed">
                    {sig.churn_followup || 'Schedule proactive Customer Success check-in to review blockers.'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
