import React, { useEffect, useState, useCallback } from 'react';
import {
  GitMerge,
  Scissors,
  Check,
  Flag,
  Pencil,
  ArrowUpRight,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  apiRequest,
  severityTextClass,
  sentimentTextClass,
  evidenceTextClass,
  formatShortDate,
} from '../lib/api';
import type { PainPointTheme, SeverityLevel, ReviewStatus } from '../../shared/types';

interface PainPointExplorerViewProps {
  workspaceId: string;
  focusThemeId?: string | null;
  onDataChanged: () => void;
  onNavigate: (tab: string) => void;
}

export const PainPointExplorerView: React.FC<PainPointExplorerViewProps> = ({
  workspaceId,
  focusThemeId,
  onDataChanged,
  onNavigate,
}) => {
  const [themes, setThemes] = useState<PainPointTheme[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusThemeId || null);
  const [severityFilter, setSeverityFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editWhy, setEditWhy] = useState('');
  const [editNext, setEditNext] = useState('');
  const [editSeverity, setEditSeverity] = useState<SeverityLevel>('Medium');

  // Merge Modal
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeTitle, setMergeTitle] = useState('');

  // Split Modal
  const [showSplit, setShowSplit] = useState(false);
  const [splitTitle, setSplitTitle] = useState('');
  const [splitDesc, setSplitDesc] = useState('');
  const [splitSelectedIds, setSplitSelectedIds] = useState<string[]>([]);

  const loadThemes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ themes?: PainPointTheme[] }>(`/api/workspaces/${workspaceId}/themes`);
      const list = Array.isArray(res?.themes) ? res.themes : [];
      setThemes(list);
      setSelectedId((prev) => {
        if (focusThemeId && list.some((t) => t.id === focusThemeId)) return focusThemeId;
        if (prev && list.some((t) => t.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (err) {
      setThemes([]);
      setError(err instanceof Error ? err.message : 'Unable to load pain point themes.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, focusThemeId]);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes]);

  const filteredThemes = themes.filter((t) => severityFilter === 'All' || t.severity === severityFilter);
  const activeTheme = themes.find((t) => t.id === selectedId) || filteredThemes[0] || null;

  function startEditing(theme: PainPointTheme) {
    setEditTitle(theme.title);
    setEditDesc(theme.description);
    setEditWhy(theme.why_happening);
    setEditNext(theme.next_investigation);
    setEditSeverity(theme.severity);
    setEditing(true);
  }

  async function saveThemeEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTheme) return;
    try {
      const res = await apiRequest<{ themes: PainPointTheme[] }>(
        `/api/workspaces/${workspaceId}/themes/${activeTheme.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: editTitle,
            description: editDesc,
            why_happening: editWhy,
            next_investigation: editNext,
            severity: editSeverity,
          }),
        }
      );
      const list = Array.isArray(res?.themes) ? res.themes : [];
      setThemes(list);
      setEditing(false);
      setNotice('Theme updated and marked as human-reviewed.');
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update theme.');
    }
  }

  async function updateReviewStatus(theme: PainPointTheme, status: ReviewStatus) {
    try {
      const res = await apiRequest<{ themes?: PainPointTheme[] }>(
        `/api/workspaces/${workspaceId}/themes/${theme.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ review_status: status }),
        }
      );
      const list = Array.isArray(res?.themes) ? res.themes : [];
      setThemes(list);
      setNotice(`Marked "${theme.title}" as ${status}.`);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update review status.');
    }
  }

  async function handleMergeSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ themes?: PainPointTheme[] }>(
        `/api/workspaces/${workspaceId}/themes/merge`,
        {
          method: 'POST',
          body: JSON.stringify({
            source_theme_id: mergeSourceId,
            target_theme_id: mergeTargetId,
            new_title: mergeTitle.trim() || undefined,
          }),
        }
      );
      const list = Array.isArray(res?.themes) ? res.themes : [];
      setThemes(list);
      setSelectedId(mergeTargetId);
      setShowMerge(false);
      setMergeTitle('');
      setNotice('Merged themes and consolidated all verbatim evidence records.');
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed.');
    }
  }

  async function handleSplitSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTheme) return;
    try {
      const res = await apiRequest<{ new_theme_id: string; themes?: PainPointTheme[] }>(
        `/api/workspaces/${workspaceId}/themes/${activeTheme.id}/split`,
        {
          method: 'POST',
          body: JSON.stringify({
            new_title: splitTitle,
            new_description: splitDesc,
            feedback_record_ids: splitSelectedIds,
          }),
        }
      );
      const list = Array.isArray(res?.themes) ? res.themes : [];
      setThemes(list);
      setSelectedId(res.new_theme_id || list[0]?.id || null);
      setShowSplit(false);
      setSplitTitle('');
      setSplitDesc('');
      setSplitSelectedIds([]);
      setNotice('Split selected quotes into a new evidence-backed theme.');
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Split failed.');
    }
  }

  async function handleCreateOpportunityFromTheme(theme: PainPointTheme) {
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/opportunities`, {
        method: 'POST',
        body: JSON.stringify({
          theme_id: theme.id,
          title: `Resolve: ${theme.title}`,
          problem_statement: theme.description,
          customer_impact: theme.why_happening || 'Addresses verified customer friction across affected segments.',
          business_impact: theme.severity_reasoning || 'Protects retention and product adoption.',
          proposed_solution: theme.next_investigation || 'Scope targeted product fix after engineering discovery.',
          recommended_next_action: theme.next_investigation || 'Review linked quotes with engineering lead.',
          reach: Math.max(50, theme.frequency * 25),
          impact: theme.severity === 'High' ? 2.5 : theme.severity === 'Medium' ? 1.5 : 0.5,
          confidence: Math.round(theme.confidence * 100),
          effort: 2.5,
        }),
      });
      onDataChanged();
      onNavigate('prioritisation');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create opportunity.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Pain Point Explorer</h1>
          <p className="text-sm text-slate-600 mt-1">
            Investigate evidence-backed themes, audit exact original customer quotes, and curate taxonomy via merge, split, and manual review.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {['All', 'High', 'Medium', 'Low'].map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  severityFilter === sev ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
          {themes.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                setMergeSourceId(themes[1]?.id || '');
                setMergeTargetId(themes[0]?.id || '');
                setShowMerge(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>Merge Themes</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-900 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-xs text-slate-500">
          Loading pain point themes and verbatim evidence...
        </div>
      ) : filteredThemes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <div className="text-sm font-semibold text-slate-900">No pain point themes found</div>
          <p className="text-xs text-slate-500 mt-1">
            Ingest customer feedback and run the OpenRouter Analysis Pipeline in Feedback Inbox to group themes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Master List */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
            {filteredThemes.map((theme) => {
              const isSelected = activeTheme?.id === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(theme.id);
                    setEditing(false);
                  }}
                  className={`w-full text-left p-4 transition-colors ${
                    isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-sm text-slate-900 leading-snug">{theme.title}</div>
                    <div className="font-mono tabular-nums text-xs font-semibold text-slate-700 shrink-0">
                      {theme.frequency}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center flex-wrap gap-1.5 text-xs text-slate-500">
                    <span className={severityTextClass(theme.severity)}>{theme.severity} severity</span>
                    <span>·</span>
                    <span className={sentimentTextClass(theme.sentiment)}>{theme.sentiment}</span>
                    <span>·</span>
                    <span className={evidenceTextClass(theme.evidence_strength)}>
                      {theme.evidence_strength} evidence
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate">{(theme.affected_segments || []).join(', ') || 'General'}</span>
                    <span className="shrink-0 ml-2">{theme.review_status}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right 7-Question Investigation Panel */}
          {activeTheme && (
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-6">
              {/* Header & Human-in-the-loop actions */}
              <div className="pb-4 border-b border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500">
                    <span className={severityTextClass(activeTheme.severity)}>{activeTheme.severity} Severity</span>
                    <span>·</span>
                    <span className={evidenceTextClass(activeTheme.evidence_strength)}>
                      {activeTheme.evidence_strength} Evidence
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {formatShortDate(activeTheme.first_reported_date)} — {formatShortDate(activeTheme.latest_reported_date)}
                    </span>
                    <span>·</span>
                    <span>{activeTheme.review_status}</span>
                  </div>
                </div>

                {!editing ? (
                  <>
                    <h2 className="text-lg font-bold text-slate-900 leading-snug">{activeTheme.title}</h2>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateReviewStatus(activeTheme, 'Verified')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Verify Theme</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateReviewStatus(activeTheme, 'Flagged')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg whitespace-nowrap"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        <span>Flag for Review</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditing(activeTheme)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/70 rounded-lg whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Rename / Edit</span>
                      </button>
                      {(activeTheme.evidence?.length || 0) >= 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSplitSelectedIds([]);
                            setShowSplit(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/70 rounded-lg whitespace-nowrap"
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          <span>Split Theme</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCreateOpportunityFromTheme(activeTheme)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap ml-auto"
                      >
                        <span>Promote to Opportunity</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <form onSubmit={saveThemeEdit} className="space-y-3 mt-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Theme Title</label>
                      <input
                        type="text"
                        required
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Problem Description</label>
                      <textarea
                        rows={2}
                        required
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Why Is It Happening?</label>
                        <textarea
                          rows={2}
                          value={editWhy}
                          onChange={(e) => setEditWhy(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Next Product Investigation</label>
                        <textarea
                          rows={2}
                          value={editNext}
                          onChange={(e) => setEditNext(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <select
                        value={editSeverity}
                        onChange={(e) => setEditSeverity(e.target.value as SeverityLevel)}
                        className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="High">High Severity</option>
                        <option value="Medium">Medium Severity</option>
                        <option value="Low">Low Severity</option>
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          className="px-3 py-1.5 text-xs text-slate-600"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>

              {/* Insufficient Evidence Guardrail */}
              {activeTheme.evidence_strength === 'Insufficient' && (
                <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/70 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 leading-relaxed">
                    <span className="font-semibold">Insufficient Supporting Evidence:</span> This theme is currently supported by fewer than 2 distinct customer records. Collect additional feedback before allocating engineering capacity.
                  </div>
                </div>
              )}

              {/* Structured 7-Question Product Investigation Grid */}
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-xs font-semibold text-slate-500">01. What is the customer problem?</div>
                  <p className="text-slate-800 mt-1 leading-relaxed">{activeTheme.description}</p>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-500">02. Why is it happening?</div>
                  <p className="text-slate-700 mt-1 leading-relaxed">
                    {activeTheme.why_happening || 'Root cause requires further engineering discovery with linked accounts.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-3.5 border-y border-slate-100">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">03. Supporting Records</div>
                    <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {activeTheme.frequency} records
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{activeTheme.trend_summary || 'Observed in workspace'}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">04. Affected Segments</div>
                    <div className="text-sm font-medium text-slate-900 mt-1">
                      {(activeTheme.affected_segments || []).join(', ') || 'General'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Confidence: <span className="font-mono">{Math.round((activeTheme.confidence || 0) * 100)}%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">05. Severity Assessment</div>
                    <div className={`text-sm mt-1 ${severityTextClass(activeTheme.severity)}`}>
                      {activeTheme.severity} Severity
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-snug">
                      {activeTheme.severity_reasoning}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-500">
                    07. What should the product team investigate next?
                  </div>
                  <p className="text-slate-800 mt-1 leading-relaxed">
                    {activeTheme.next_investigation || 'Interview 3–5 affected customers from the evidence list below.'}
                  </p>
                </div>

                {/* Question 06: Exact Verbatim Evidence Quotes */}
                <div className="pt-2">
                  <div className="flex items-baseline justify-between mb-3">
                    <div className="text-xs font-semibold text-slate-500">
                      06. Exact Verbatim Supporting Evidence ({activeTheme.evidence?.length || 0} linked records)
                    </div>
                    <span className="text-[11px] text-slate-400">Unaltered original customer quotes</span>
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {(activeTheme.evidence || []).map((ev) => (
                      <div key={ev.id} className="p-4">
                        <p className="text-sm text-slate-900 leading-relaxed">&ldquo;{ev.original_quote}&rdquo;</p>
                        <div className="mt-2 flex items-center flex-wrap gap-2 text-xs text-slate-500">
                          <span className="font-mono font-medium text-slate-700">{ev.feedback_id}</span>
                          <span>·</span>
                          <span>{ev.source}</span>
                          <span>·</span>
                          <span className="font-mono">{ev.feedback_date}</span>
                          <span>·</span>
                          <span>{ev.customer_segment}</span>
                          {ev.customer_id && (
                            <>
                              <span>·</span>
                              <span className="font-mono">{ev.customer_id}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Merge Themes Modal */}
      {showMerge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form
            onSubmit={handleMergeSubmit}
            className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Merge Two Pain Point Themes</h3>
              <button type="button" onClick={() => setShowMerge(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              All verbatim evidence quotes and linked opportunities from the source theme will transfer to the target theme.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Source Theme (will be merged & removed)</label>
              <select
                value={mergeSourceId}
                onChange={(e) => setMergeSourceId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.title} ({t.frequency} quotes)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Target Theme (kept)</label>
              <select
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.title} ({t.frequency} quotes)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Optional Combined Title</label>
              <input
                type="text"
                value={mergeTitle}
                onChange={(e) => setMergeTitle(e.target.value)}
                placeholder="Leave blank to retain target title"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowMerge(false)} className="px-3.5 py-2 text-xs text-slate-600">
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Confirm Merge
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Split Theme Modal */}
      {showSplit && activeTheme && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form
            onSubmit={handleSplitSubmit}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Split Selected Evidence into New Theme</h3>
              <button type="button" onClick={() => setShowSplit(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Theme Title *</label>
              <input
                type="text"
                required
                value={splitTitle}
                onChange={(e) => setSplitTitle(e.target.value)}
                placeholder="e.g. Role Permissions Complexity During Enterprise Setup"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Theme Description *</label>
              <textarea
                rows={2}
                required
                value={splitDesc}
                onChange={(e) => setSplitDesc(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-700 mb-2">
                Select Verbatim Records to Move ({splitSelectedIds.length} selected)
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {(activeTheme.evidence || []).map((ev) => {
                  const checked = splitSelectedIds.includes(ev.feedback_record_id);
                  return (
                    <label
                      key={ev.id}
                      className="flex items-start gap-2.5 p-3 text-xs hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSplitSelectedIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== ev.feedback_record_id)
                              : [...prev, ev.feedback_record_id]
                          )
                        }
                        className="mt-0.5 rounded border-slate-300 text-blue-600"
                      />
                      <div>
                        <span className="font-mono text-slate-500 mr-2">{ev.feedback_id}</span>
                        <span className="text-slate-800">{ev.original_quote}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowSplit(false)} className="px-3.5 py-2 text-xs text-slate-600">
                Cancel
              </button>
              <button
                type="submit"
                disabled={splitSelectedIds.length === 0}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
              >
                Create Split Theme
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
