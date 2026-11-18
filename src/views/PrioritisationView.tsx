import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Plus, ArrowUpRight, Info, X, Trash2 } from 'lucide-react';
import { apiRequest, priorityTextClass } from '../lib/api';
import type { Opportunity } from '../../shared/types';

interface PrioritisationViewProps {
  workspaceId: string;
  focusOpportunityId?: string | null;
  onDataChanged: () => void;
  onNavigate: (tab: string) => void;
}

const IMPACT_OPTIONS = [
  { value: 3.0, label: '3.0 (Massive)' },
  { value: 2.5, label: '2.5 (Very High)' },
  { value: 2.0, label: '2.0 (High)' },
  { value: 1.5, label: '1.5 (Medium-High)' },
  { value: 1.0, label: '1.0 (Medium)' },
  { value: 0.5, label: '0.5 (Low)' },
  { value: 0.25, label: '0.25 (Minimal)' },
];

function calcRice(reach: number, impact: number, confidence: number, effort: number): number {
  return Number(((reach * impact * (confidence / 100)) / Math.max(0.5, effort)).toFixed(1));
}

export const PrioritisationView: React.FC<PrioritisationViewProps> = ({
  workspaceId,
  focusOpportunityId,
  onDataChanged,
  onNavigate,
}) => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusOpportunityId || null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New Opportunity Modal
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProblem, setNewProblem] = useState('');
  const [newSolution, setNewSolution] = useState('');
  const [newNextAction, setNewNextAction] = useState('');
  const [newReach, setNewReach] = useState(200);
  const [newImpact, setNewImpact] = useState(2.0);
  const [newConfidence, setNewConfidence] = useState(80);
  const [newEffort, setNewEffort] = useState(2.0);

  // Convert to Action Plan Modal
  const [convertOpp, setConvertOpp] = useState<Opportunity | null>(null);
  const [planOwner, setPlanOwner] = useState('Product Manager');
  const [planNextSteps, setPlanNextSteps] = useState('');

  const loadOpportunities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ opportunities?: Opportunity[] }>(
        `/api/workspaces/${workspaceId}/opportunities`
      );
      const list = Array.isArray(res?.opportunities) ? res.opportunities : [];
      setOpportunities(list);
      setSelectedId((prev) => {
        if (focusOpportunityId && list.some((o) => o.id === focusOpportunityId)) {
          return focusOpportunityId;
        }
        if (prev && list.some((o) => o.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (err) {
      setOpportunities([]);
      setError(err instanceof Error ? err.message : 'Unable to load opportunities.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, focusOpportunityId]);

  useEffect(() => {
    void loadOpportunities();
  }, [loadOpportunities]);

  async function updateRiceField(
    opp: Opportunity,
    patch: Partial<Pick<Opportunity, 'reach' | 'impact' | 'confidence' | 'effort' | 'status'>>
  ) {
    const nextReach = patch.reach ?? opp.reach;
    const nextImpact = patch.impact ?? opp.impact;
    const nextConfidence = patch.confidence ?? opp.confidence;
    const nextEffort = patch.effort ?? opp.effort;
    const optimisticRice = calcRice(nextReach, nextImpact, nextConfidence, nextEffort);

    // Instant local recalculation & re-ranking
    setOpportunities((prev) =>
      prev
        .map((item) =>
          item.id === opp.id
            ? {
                ...item,
                ...patch,
                rice_score: optimisticRice,
              }
            : item
        )
        .sort((a, b) => b.rice_score - a.rice_score)
    );

    setSavingId(opp.id);
    try {
      const res = await apiRequest<{ opportunities: Opportunity[] }>(
        `/api/workspaces/${workspaceId}/opportunities/${opp.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }
      );
      setOpportunities(res.opportunities);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to persist RICE update.');
      await loadOpportunities();
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreateOpportunity(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ id: string; opportunities: Opportunity[] }>(
        `/api/workspaces/${workspaceId}/opportunities`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: newTitle,
            problem_statement: newProblem,
            proposed_solution: newSolution,
            recommended_next_action: newNextAction,
            reach: newReach,
            impact: newImpact,
            confidence: newConfidence,
            effort: newEffort,
          }),
        }
      );
      const list = Array.isArray(res?.opportunities) ? res.opportunities : [];
      setOpportunities(list);
      setSelectedId(res.id || list[0]?.id || null);
      setShowCreate(false);
      setNewTitle('');
      setNewProblem('');
      setNewSolution('');
      setNewNextAction('');
      setNotice('Added opportunity and recalculated workspace RICE rankings.');
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create opportunity.');
    }
  }

  async function handleConvertToActionPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!convertOpp) return;
    try {
      const steps = planNextSteps
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      await apiRequest(`/api/workspaces/${workspaceId}/action-plans`, {
        method: 'POST',
        body: JSON.stringify({
          opportunity_id: convertOpp.id,
          title: convertOpp.title,
          problem_statement: convertOpp.problem_statement,
          evidence_summary: `${convertOpp.evidence_count || 0} linked customer feedback quotes (RICE ${convertOpp.rice_score}).`,
          description: convertOpp.proposed_solution || convertOpp.recommended_next_action,
          expected_impact: convertOpp.customer_impact || convertOpp.business_impact,
          owner: planOwner,
          priority: convertOpp.priority,
          status: 'Not started',
          next_steps: steps.length > 0 ? steps : [convertOpp.recommended_next_action || 'Scope engineering plan'],
        }),
      });
      setConvertOpp(null);
      setNotice('Converted opportunity into an owned Action Plan.');
      onDataChanged();
      onNavigate('actions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed.');
    }
  }

  async function handleDeleteOpportunity(opp: Opportunity) {
    try {
      const res = await apiRequest<{ opportunities?: Opportunity[] }>(
        `/api/workspaces/${workspaceId}/opportunities/${opp.id}`,
        { method: 'DELETE' }
      );
      const list = Array.isArray(res?.opportunities) ? res.opportunities : [];
      setOpportunities(list);
      if (selectedId === opp.id) setSelectedId(list[0]?.id || null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete opportunity.');
    }
  }

  const activeOpp = opportunities.find((o) => o.id === selectedId) || opportunities[0] || null;
  const scatterData = opportunities.map((o, idx) => ({
    rank: idx + 1,
    name: o.title,
    effort: o.effort,
    impact: o.impact,
    rice: o.rice_score,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dynamic RICE Prioritisation</h1>
          <p className="text-sm text-slate-600 mt-1">
            Formula: <span className="font-mono text-slate-800">RICE = (Reach × Impact × Confidence%) / Effort</span>. Edit any input inline to recalculate priority rankings immediately.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Opportunity</span>
        </button>
      </div>

      {/* PM Decision Governance Callout */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-3 text-xs text-slate-700">
        <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <p>
          AI-suggested opportunities and initial RICE estimates are <span className="font-semibold text-slate-900">recommendations, not automatic product decisions</span>. Validate Reach, Impact, Confidence, and Engineering Effort with your team before converting to Action Plans.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">{error}</div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-900">{notice}</div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
          Loading RICE prioritisation model...
        </div>
      ) : opportunities.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <div className="text-sm font-semibold text-slate-900">No product opportunities yet</div>
          <p className="text-xs text-slate-500 mt-1">
            Run OpenRouter AI analysis in Feedback Inbox, promote a theme from Pain Point Explorer, or add an opportunity manually.
          </p>
        </div>
      ) : (
        <>
          {/* Live Interactive RICE Scoring Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">Rank</th>
                    <th className="py-2.5 px-4">Opportunity</th>
                    <th className="py-2.5 px-3 text-right">Reach</th>
                    <th className="py-2.5 px-3 text-right">Impact</th>
                    <th className="py-2.5 px-3 text-right">Confidence</th>
                    <th className="py-2.5 px-3 text-right">Effort (wks)</th>
                    <th className="py-2.5 px-4 text-right">RICE Score</th>
                    <th className="py-2.5 px-4">Priority</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {opportunities.map((opp, idx) => {
                    const isSelected = activeOpp?.id === opp.id;
                    return (
                      <tr
                        key={opp.id}
                        onClick={() => setSelectedId(opp.id)}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-500">
                          #{idx + 1}
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <div className="font-medium text-slate-900 text-sm">{opp.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {opp.evidence_count || 0} linked quotes · {opp.status}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            value={opp.reach}
                            onChange={(e) =>
                              updateRiceField(opp, { reach: Math.max(1, Number(e.target.value) || 1) })
                            }
                            aria-label={`Reach for ${opp.title}`}
                            className="w-20 px-2 py-1 text-right font-mono tabular-nums bg-white border border-slate-200 rounded focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={opp.impact}
                            onChange={(e) => updateRiceField(opp, { impact: Number(e.target.value) })}
                            aria-label={`Impact for ${opp.title}`}
                            className="px-2 py-1 font-mono tabular-nums bg-white border border-slate-200 rounded focus:border-blue-600 focus:outline-none"
                          >
                            {IMPACT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.value}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min={10}
                              max={100}
                              step={5}
                              value={opp.confidence}
                              onChange={(e) =>
                                updateRiceField(opp, {
                                  confidence: Math.min(100, Math.max(10, Number(e.target.value) || 10)),
                                })
                              }
                              aria-label={`Confidence for ${opp.title}`}
                              className="w-16 px-2 py-1 text-right font-mono tabular-nums bg-white border border-slate-200 rounded focus:border-blue-600 focus:outline-none"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            min={0.5}
                            max={52}
                            step={0.5}
                            value={opp.effort}
                            onChange={(e) =>
                              updateRiceField(opp, { effort: Math.max(0.5, Number(e.target.value) || 0.5) })
                            }
                            aria-label={`Effort for ${opp.title}`}
                            className="w-16 px-2 py-1 text-right font-mono tabular-nums bg-white border border-slate-200 rounded focus:border-blue-600 focus:outline-none"
                          />
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-base font-bold text-blue-700">
                          {opp.rice_score}
                          {savingId === opp.id && <span className="ml-1 text-[10px] text-slate-400">...</span>}
                        </td>
                        <td className={`py-3 px-4 whitespace-nowrap ${priorityTextClass(opp.priority)}`}>
                          {opp.priority}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => {
                              setConvertOpp(opp);
                              setPlanOwner('Product Manager');
                              setPlanNextSteps(
                                [
                                  opp.recommended_next_action,
                                  'Review linked verbatim customer quotes with engineering lead',
                                  'Define release milestones and success metrics',
                                ]
                                  .filter(Boolean)
                                  .join('\n')
                              );
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap"
                          >
                            <span>To Action Plan</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail Reasoning + Impact vs Effort Quadrant */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {activeOpp && (
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className={priorityTextClass(activeOpp.priority)}>{activeOpp.priority}</span>
                      <span>·</span>
                      <span className="font-mono font-semibold text-blue-700">RICE {activeOpp.rice_score}</span>
                      <span>·</span>
                      <span>{activeOpp.status}</span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-1">{activeOpp.title}</h2>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={activeOpp.status}
                      onChange={(e) =>
                        updateRiceField(activeOpp, { status: e.target.value as Opportunity['status'] })
                      }
                      className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                    >
                      <option value="Proposed">Proposed</option>
                      <option value="Under Review">Under Review</option>
                      <option value="Approved">Approved</option>
                      <option value="Converted">Converted</option>
                      <option value="Deferred">Deferred</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleDeleteOpportunity(activeOpp)}
                      aria-label="Delete opportunity"
                      className="p-1.5 text-slate-400 hover:text-red-700 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3 text-xs leading-relaxed">
                  <div>
                    <div className="font-semibold text-slate-500">Problem Statement</div>
                    <p className="text-slate-800 mt-0.5 text-sm">{activeOpp.problem_statement}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="font-semibold text-slate-500">Customer Impact</div>
                      <p className="text-slate-700 mt-0.5">{activeOpp.customer_impact || '—'}</p>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-500">Business Impact</div>
                      <p className="text-slate-700 mt-0.5">{activeOpp.business_impact || '—'}</p>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-500">Proposed Solution</div>
                    <p className="text-slate-800 mt-0.5">{activeOpp.proposed_solution || '—'}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-500">Recommended Next Action</div>
                    <p className="text-slate-900 font-medium mt-0.5">{activeOpp.recommended_next_action || '—'}</p>
                  </div>

                  {(activeOpp.assumptions.length > 0 || activeOpp.risks.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                      <div>
                        <div className="font-semibold text-slate-500 mb-1">Key Assumptions</div>
                        <ul className="list-disc pl-4 space-y-1 text-slate-700">
                          {activeOpp.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-500 mb-1">Risks & Trade-offs</div>
                        <ul className="list-disc pl-4 space-y-1 text-slate-700">
                          {activeOpp.risks.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}

                  {(activeOpp.sample_quotes?.length || 0) > 0 && (
                    <div className="pt-3 border-t border-slate-100">
                      <div className="font-semibold text-slate-500 mb-2">
                        Supporting Verbatim Evidence ({activeOpp.evidence_count} total linked quotes)
                      </div>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {activeOpp.sample_quotes!.map((q, idx) => (
                          <div key={idx} className="p-3">
                            <p className="text-slate-800">&ldquo;{q.original_quote}&rdquo;</p>
                            <div className="text-[11px] font-mono text-slate-400 mt-1">
                              {q.feedback_id} · {q.customer_segment} · {q.source} · {q.feedback_date}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900">Impact vs. Effort Portfolio Map</h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Upper-left opportunities deliver high customer impact with lower engineering effort
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 16, bottom: 16, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      type="number"
                      dataKey="effort"
                      name="Effort"
                      unit="w"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      label={{ value: 'Effort (person-weeks)', position: 'insideBottom', offset: -8, fontSize: 11, fill: '#64748B' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="impact"
                      name="Impact"
                      domain={[0, 3.2]}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                    />
                    <ZAxis type="number" dataKey="rice" range={[60, 320]} name="RICE" />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload }) => {
                        const first = payload?.[0]?.payload as { name: string; rice: number; effort: number; impact: number } | undefined;
                        if (!active || !first) return null;
                        const d = first;
                        return (
                          <div className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-md text-xs max-w-[220px]">
                            <div className="font-semibold text-slate-900">{d.name}</div>
                            <div className="font-mono text-slate-600 mt-1">
                              RICE {d.rice} · Impact {d.impact} · Effort {d.effort}w
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData} fill="#2563EB" fillOpacity={0.8} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Create Opportunity Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form
            onSubmit={handleCreateOpportunity}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Add Product Opportunity</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Opportunity Title *</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Problem Statement *</label>
              <textarea
                rows={2}
                required
                value={newProblem}
                onChange={(e) => setNewProblem(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Proposed Solution</label>
                <input
                  type="text"
                  value={newSolution}
                  onChange={(e) => setNewSolution(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Recommended Next Action</label>
                <input
                  type="text"
                  value={newNextAction}
                  onChange={(e) => setNewNextAction(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Reach</label>
                <input
                  type="number"
                  min={1}
                  value={newReach}
                  onChange={(e) => setNewReach(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Impact</label>
                <select
                  value={newImpact}
                  onChange={(e) => setNewImpact(Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                >
                  {IMPACT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Conf %</label>
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={newConfidence}
                  onChange={(e) => setNewConfidence(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Effort (w)</label>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={newEffort}
                  onChange={(e) => setNewEffort(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="text-xs text-slate-600">
              Preview RICE Score:{' '}
              <span className="font-mono font-bold text-blue-700">
                {calcRice(newReach, newImpact, newConfidence, newEffort)}
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-3.5 py-2 text-xs text-slate-600">
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Save Opportunity
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Convert to Action Plan Modal */}
      {convertOpp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form
            onSubmit={handleConvertToActionPlan}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Convert Opportunity to Action Plan</h3>
              <button type="button" onClick={() => setConvertOpp(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-700 font-medium">{convertOpp.title}</div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Suggested Owner *</label>
              <input
                type="text"
                required
                value={planOwner}
                onChange={(e) => setPlanOwner(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Next Steps (one per line)</label>
              <textarea
                rows={4}
                value={planNextSteps}
                onChange={(e) => setPlanNextSteps(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setConvertOpp(null)} className="px-3.5 py-2 text-xs text-slate-600">
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Create Action Plan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
