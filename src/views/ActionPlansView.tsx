import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, CheckCircle2, Circle } from 'lucide-react';
import { apiRequest, priorityTextClass, actionStatusTextClass } from '../lib/api';
import type { ActionPlan, ActionStatus, PriorityLevel } from '../../shared/types';

interface ActionPlansViewProps {
  workspaceId: string;
  onDataChanged: () => void;
}

export const ActionPlansView: React.FC<ActionPlansViewProps> = ({
  workspaceId,
  onDataChanged,
}) => {
  const [plans, setPlans] = useState<ActionPlan[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ActionPlan | null>(null);
  const [title, setTitle] = useState('');
  const [problemStatement, setProblemStatement] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [description, setDescription] = useState('');
  const [expectedImpact, setExpectedImpact] = useState('');
  const [owner, setOwner] = useState('');
  const [priority, setPriority] = useState<PriorityLevel>('P1 - High');
  const [status, setStatus] = useState<ActionStatus>('Not started');
  const [nextStepsText, setNextStepsText] = useState('');

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<ActionPlan | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ action_plans?: ActionPlan[] }>(
        `/api/workspaces/${workspaceId}/action-plans`
      );
      setPlans(Array.isArray(res?.action_plans) ? res.action_plans : []);
    } catch (err) {
      setPlans([]);
      setError(err instanceof Error ? err.message : 'Unable to load action plans.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  function openCreateModal() {
    setEditingPlan(null);
    setTitle('');
    setProblemStatement('');
    setEvidenceSummary('');
    setDescription('');
    setExpectedImpact('');
    setOwner('Product Manager');
    setPriority('P1 - High');
    setStatus('Not started');
    setNextStepsText('');
    setModalOpen(true);
  }

  function openEditModal(plan: ActionPlan) {
    setEditingPlan(plan);
    setTitle(plan.title);
    setProblemStatement(plan.problem_statement);
    setEvidenceSummary(plan.evidence_summary);
    setDescription(plan.description);
    setExpectedImpact(plan.expected_impact);
    setOwner(plan.owner);
    setPriority(plan.priority);
    setStatus(plan.status);
    setNextStepsText(plan.next_steps.join('\n'));
    setModalOpen(true);
  }

  async function handleSaveModal(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      title,
      problem_statement: problemStatement,
      evidence_summary: evidenceSummary,
      description,
      expected_impact: expectedImpact,
      owner,
      priority,
      status,
      next_steps: nextStepsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      const res = editingPlan
        ? await apiRequest<{ action_plans?: ActionPlan[] }>(
            `/api/workspaces/${workspaceId}/action-plans/${editingPlan.id}`,
            { method: 'PATCH', body: JSON.stringify(payload) }
          )
        : await apiRequest<{ action_plans?: ActionPlan[] }>(
            `/api/workspaces/${workspaceId}/action-plans`,
            { method: 'POST', body: JSON.stringify(payload) }
          );
      setPlans(Array.isArray(res?.action_plans) ? res.action_plans : []);
      setModalOpen(false);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save action plan.');
    }
  }

  async function quickStatusChange(plan: ActionPlan, nextStatus: ActionStatus) {
    try {
      const res = await apiRequest<{ action_plans?: ActionPlan[] }>(
        `/api/workspaces/${workspaceId}/action-plans/${plan.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }
      );
      setPlans(Array.isArray(res?.action_plans) ? res.action_plans : []);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update action plan status.');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      const res = await apiRequest<{ action_plans?: ActionPlan[] }>(
        `/api/workspaces/${workspaceId}/action-plans/${deleteTarget.id}`,
        { method: 'DELETE' }
      );
      setPlans(Array.isArray(res?.action_plans) ? res.action_plans : []);
      setDeleteTarget(null);
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete action plan.');
    }
  }

  const filtered = plans.filter((p) => statusFilter === 'All' || p.status === statusFilter);
  const counts = {
    all: plans.length,
    notStarted: plans.filter((p) => p.status === 'Not started').length,
    inProgress: plans.filter((p) => p.status === 'In progress').length,
    completed: plans.filter((p) => p.status === 'Completed').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Action Plans</h1>
          <p className="text-sm text-slate-600 mt-1">
            Close the loop from evidence-backed customer insights to owned product and customer success execution.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Action Plan</span>
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">{error}</div>
      )}

      {/* Segmented Status Filter */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {[
          { key: 'All', label: `All (${counts.all})` },
          { key: 'Not started', label: `Not started (${counts.notStarted})` },
          { key: 'In progress', label: `In progress (${counts.inProgress})` },
          { key: 'Completed', label: `Completed (${counts.completed})` },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setStatusFilter(item.key)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              statusFilter === item.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
          Loading action plans...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
          <div className="text-sm font-semibold text-slate-900">No action plans in this status</div>
          <p className="text-xs text-slate-500 mt-1">
            Convert a prioritised opportunity or click New Action Plan to track execution.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((plan) => (
            <div key={plan.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500 mb-1">
                    <span className={priorityTextClass(plan.priority)}>{plan.priority}</span>
                    <span>·</span>
                    <span className={actionStatusTextClass(plan.status)}>{plan.status}</span>
                    <span>·</span>
                    <span>Owner: <span className="font-medium text-slate-700">{plan.owner}</span></span>
                    {plan.opportunity_title && (
                      <>
                        <span>·</span>
                        <span className="text-blue-700">From: {plan.opportunity_title}</span>
                      </>
                    )}
                  </div>
                  <h2 className="text-base font-semibold text-slate-900">{plan.title}</h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={plan.status}
                    onChange={(e) => quickStatusChange(plan, e.target.value as ActionStatus)}
                    aria-label={`Status for ${plan.title}`}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-medium text-slate-700"
                  >
                    <option value="Not started">Not started</option>
                    <option value="In progress">In progress</option>
                    <option value="Completed">Completed</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => openEditModal(plan)}
                    aria-label={`Edit ${plan.title}`}
                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(plan)}
                    aria-label={`Delete ${plan.title}`}
                    className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-100">
                <div>
                  <div className="font-semibold text-slate-500">Problem Statement</div>
                  <p className="text-slate-800 mt-1 leading-relaxed">{plan.problem_statement || '—'}</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Supporting Evidence</div>
                  <p className="text-slate-700 mt-1 leading-relaxed">{plan.evidence_summary || '—'}</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Proposed Solution</div>
                  <p className="text-slate-800 mt-1 leading-relaxed">{plan.description || '—'}</p>
                </div>
                <div>
                  <div className="font-semibold text-slate-500">Expected Customer Impact</div>
                  <p className="text-slate-800 mt-1 leading-relaxed">{plan.expected_impact || '—'}</p>
                </div>
              </div>

              {plan.next_steps.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 mb-2">Next Steps</div>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {plan.next_steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2">
                        {plan.status === 'Completed' || step.toLowerCase().includes('(done)') || step.toLowerCase().includes('(completed)') ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-0.5" />
                        )}
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveModal}
            className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4 my-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingPlan ? 'Edit Action Plan' : 'Create Action Plan'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Action Plan Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Owner *</label>
                <input
                  type="text"
                  required
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="P0 - Critical">P0 - Critical</option>
                  <option value="P1 - High">P1 - High</option>
                  <option value="P2 - Medium">P2 - Medium</option>
                  <option value="P3 - Low">P3 - Low</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ActionStatus)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Not started">Not started</option>
                  <option value="In progress">In progress</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Problem Statement</label>
                <textarea
                  rows={2}
                  value={problemStatement}
                  onChange={(e) => setProblemStatement(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Supporting Evidence</label>
                <textarea
                  rows={2}
                  value={evidenceSummary}
                  onChange={(e) => setEvidenceSummary(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Proposed Solution</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Expected Customer Impact</label>
                <textarea
                  rows={2}
                  value={expectedImpact}
                  onChange={(e) => setExpectedImpact(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Next Steps (one per line)</label>
              <textarea
                rows={4}
                value={nextStepsText}
                onChange={(e) => setNextStepsText(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-3.5 py-2 text-xs text-slate-600">
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                {editingPlan ? 'Save Changes' : 'Create Action Plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Explicit Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Delete Action Plan?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              This will permanently remove <span className="font-semibold text-slate-900">&ldquo;{deleteTarget.title}&rdquo;</span> from this workspace. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
