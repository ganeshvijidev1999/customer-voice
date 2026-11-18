import React, { useEffect, useState, useCallback } from 'react';
import { UserPlus, Trash2, Play, Copy, Check, Database, ShieldCheck } from 'lucide-react';
import { apiRequest, sentimentTextClass, severityTextClass } from '../lib/api';
import type {
  Workspace,
  WorkspaceMember,
  RuntimeStatus,
  AIProcessingLog,
  GoldenEvaluationItem,
  EvaluationRunResult,
} from '../../shared/types';

interface SettingsViewProps {
  workspace: Workspace;
  runtime: RuntimeStatus | null;
  onWorkspaceUpdated: (workspace: Workspace, workspaces: Workspace[]) => void;
}

type SettingsTab = 'workspace' | 'team' | 'evaluation' | 'cost' | 'architecture';

interface EvaluationApiResponse {
  proposed_targets: {
    classification_precision: number;
    classification_recall: number;
    sentiment_agreement: number;
    theme_grouping_quality: number;
    evidence_traceability: number;
    invalid_ai_responses_max: number;
    human_correction_rate_max: number;
  };
  golden_dataset: GoldenEvaluationItem[];
  workspace_live_governance: {
    evidence_traceability: number;
    human_correction_rate: number;
    invalid_ai_responses: number;
  };
  measured_runs: EvaluationRunResult[];
  gemini_configured: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  workspace,
  runtime,
  onWorkspaceUpdated,
}) => {
  const [tab, setTab] = useState<SettingsTab>('workspace');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Workspace Profile Form
  const [companyName, setCompanyName] = useState(workspace.company_name);
  const [industry, setIndustry] = useState(workspace.industry);
  const [businessType, setBusinessType] = useState(workspace.business_type);
  const [userRole, setUserRole] = useState(workspace.user_role);
  const [primaryObjective, setPrimaryObjective] = useState(workspace.primary_objective);
  const [savingWs, setSavingWs] = useState(false);

  // Team Members
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');

  // Evaluation Harness
  const [evalData, setEvalData] = useState<EvaluationApiResponse | null>(null);
  const [runningEval, setRunningEval] = useState(false);

  // Cost & AI Logs
  const [logs, setLogs] = useState<AIProcessingLog[]>([]);
  const [liveRuntime, setLiveRuntime] = useState<RuntimeStatus | null>(runtime);

  // Schema SQL
  const [schemaSql, setSchemaSql] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    setCompanyName(workspace.company_name);
    setIndustry(workspace.industry);
    setBusinessType(workspace.business_type);
    setUserRole(workspace.user_role);
    setPrimaryObjective(workspace.primary_objective);
  }, [workspace]);

  const loadSettingsData = useCallback(async () => {
    try {
      const [mRes, eRes, jRes, sqlRes] = await Promise.all([
        apiRequest<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspace.id}/members`),
        apiRequest<EvaluationApiResponse>(`/api/workspaces/${workspace.id}/evaluation`),
        apiRequest<{ logs: AIProcessingLog[]; runtime: RuntimeStatus }>(`/api/workspaces/${workspace.id}/analysis/jobs`),
        apiRequest<{ sql: string }>('/api/system/schema-sql'),
      ]);
      setMembers(mRes.members);
      setEvalData(eRes);
      setLogs(jRes.logs);
      setLiveRuntime(jRes.runtime);
      setSchemaSql(sqlRes.sql);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workspace settings.');
    }
  }, [workspace.id]);

  useEffect(() => {
    void loadSettingsData();
  }, [loadSettingsData]);

  async function saveWorkspaceProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingWs(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ workspace: Workspace; workspaces: Workspace[] }>(
        `/api/workspaces/${workspace.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: companyName,
            company_name: companyName,
            industry,
            business_type: businessType,
            user_role: userRole,
            primary_objective: primaryObjective,
          }),
        }
      );
      onWorkspaceUpdated(res.workspace, res.workspaces);
      setNotice('Workspace onboarding profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update workspace.');
    } finally {
      setSavingWs(false);
    }
  }

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ members: WorkspaceMember[] }>(
        `/api/workspaces/${workspace.id}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        }
      );
      setMembers(res.members);
      setInviteEmail('');
      setNotice('Workspace invitation created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to invite member.');
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/members/${memberId}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove member.');
    }
  }

  async function handleRunGoldenEvaluation() {
    setRunningEval(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/evaluation/run`, { method: 'POST' });
      await loadSettingsData();
      setNotice('Completed live OpenRouter AI evaluation against the Golden Dataset.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation run failed.');
    } finally {
      setRunningEval(false);
    }
  }

  function copySql() {
    navigator.clipboard.writeText(schemaSql).then(() => {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    });
  }

  const latestEvalRun = evalData?.measured_runs[0] || null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Workspace Settings & AI Governance</h1>
        <p className="text-sm text-slate-600 mt-1">
          Configure workspace context, team access, AI quality evaluation benchmarks, cost guardrails, and Supabase PostgreSQL schema setup.
        </p>
      </div>

      {/* Segmented Settings Navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(
          [
            { id: 'workspace', label: 'Workspace Profile' },
            { id: 'team', label: `Team & Access (${members.length})` },
            { id: 'evaluation', label: 'AI Quality & Evaluation' },
            { id: 'cost', label: 'Cost & Usage Monitor' },
            { id: 'architecture', label: 'Supabase & Schema' },
          ] as Array<{ id: SettingsTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setError(null);
              setNotice(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">{error}</div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-900">{notice}</div>
      )}

      {/* TAB 1: WORKSPACE PROFILE */}
      {tab === 'workspace' && (
        <form
          onSubmit={saveWorkspaceProfile}
          className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl space-y-4"
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">Workspace Context & Business Objective</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Guides prioritisation framing and executive report headers for this isolated workspace.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Company / Workspace Name</label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Industry</label>
              <input
                type="text"
                required
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Business Type</label>
              <input
                type="text"
                required
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Primary Role</label>
              <input
                type="text"
                required
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Primary Business Objective</label>
              <input
                type="text"
                required
                value={primaryObjective}
                onChange={(e) => setPrimaryObjective(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={savingWs}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              {savingWs ? 'Saving...' : 'Save Workspace Settings'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: TEAM & ACCESS */}
      {tab === 'team' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6 max-w-3xl">
          <form onSubmit={handleInviteMember} className="space-y-3 pb-6 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Invite Workspace Members</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Invited teammates automatically gain access to this isolated workspace when they sign in or register with that email.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Send Invite</span>
              </button>
            </div>
          </form>

          <div>
            <h3 className="text-xs font-semibold text-slate-500 mb-3">Workspace Roster</h3>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
              {members.map((m) => (
                <div key={m.id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-slate-900">{m.full_name || m.email}</div>
                    <div className="text-slate-500 font-mono text-[11px]">{m.email}</div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="capitalize text-slate-700 font-medium">{m.role}</span>
                    <span className={m.status === 'active' ? 'text-emerald-700' : 'text-amber-700'}>
                      {m.status === 'active' ? 'Active' : 'Invited'}
                    </span>
                    {m.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.id)}
                        aria-label={`Remove ${m.email}`}
                        className="text-slate-400 hover:text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: AI QUALITY & EVALUATION HARNESS */}
      {tab === 'evaluation' && evalData && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">AI Quality & Golden Dataset Evaluation</h2>
                <p className="text-xs text-slate-600 mt-1">
                  Clearly distinguishes <span className="font-semibold text-slate-900">Proposed Quality Targets</span> from{' '}
                  <span className="font-semibold text-slate-900">Live Measured Results</span>. Evaluation scores are never fabricated.
                </p>
              </div>
              <button
                type="button"
                disabled={runningEval}
                onClick={handleRunGoldenEvaluation}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{runningEval ? 'Running Live Evaluation...' : 'Run Golden Evaluation (Live OpenRouter AI)'}</span>
              </button>
            </div>

            {/* Governance Comparison Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-4 font-semibold">Evaluation Dimension</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Proposed Target</th>
                    <th className="py-2.5 px-4 text-right font-semibold">Measured Result (Live)</th>
                    <th className="py-2.5 px-4 font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Classification Precision</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      ≥ {(evalData.proposed_targets.classification_precision * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {latestEvalRun ? `${(latestEvalRun.classification_precision * 100).toFixed(1)}%` : 'Not yet measured'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Golden Dataset Live Run</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Classification Recall</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      ≥ {(evalData.proposed_targets.classification_recall * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {latestEvalRun ? `${(latestEvalRun.classification_recall * 100).toFixed(1)}%` : 'Not yet measured'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Golden Dataset Live Run</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Sentiment Agreement</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      ≥ {(evalData.proposed_targets.sentiment_agreement * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {latestEvalRun ? `${(latestEvalRun.sentiment_agreement * 100).toFixed(1)}%` : 'Not yet measured'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Golden Dataset Live Run</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Theme Grouping Quality</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      ≥ {(evalData.proposed_targets.theme_grouping_quality * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {latestEvalRun ? `${(latestEvalRun.theme_grouping_quality * 100).toFixed(1)}%` : 'Not yet measured'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Golden Dataset Live Run</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Verbatim Evidence Traceability</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">100.0%</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      {(evalData.workspace_live_governance.evidence_traceability * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Live DB Verbatim Audit</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Invalid AI JSON Responses</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">0</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {evalData.workspace_live_governance.invalid_ai_responses}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Live Processing Logs</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4 font-medium text-slate-900">Human Correction Rate</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      ≤ {(evalData.proposed_targets.human_correction_rate_max * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {(evalData.workspace_live_governance.human_correction_rate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-slate-500">Live Workspace Overrides</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 10-Item Manually Labelled Golden Dataset */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Manually Labelled Golden Evaluation Dataset ({evalData.golden_dataset.length} benchmark cases)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Includes edge cases testing sentiment-vs-severity decoupling (neutral high-severity & negative low-severity) and uncertain language.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2 px-4">ID</th>
                    <th className="py-2 px-4">Golden Verbatim Input</th>
                    <th className="py-2 px-4">Expected Category</th>
                    <th className="py-2 px-4">Sentiment</th>
                    <th className="py-2 px-4">Severity</th>
                    <th className="py-2 px-4">Test Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {evalData.golden_dataset.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">{item.id}</td>
                      <td className="py-2.5 px-4 text-slate-800 max-w-sm">&ldquo;{item.feedback_text}&rdquo;</td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">{item.expected_category}</td>
                      <td className={`py-2.5 px-4 whitespace-nowrap ${sentimentTextClass(item.expected_sentiment)}`}>
                        {item.expected_sentiment}
                      </td>
                      <td className={`py-2.5 px-4 whitespace-nowrap ${severityTextClass(item.expected_severity)}`}>
                        {item.expected_severity}
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">{item.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: COST OPTIMISATION & AI PROCESSING LOGS */}
      {tab === 'cost' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            <div className="p-4">
              <div className="text-xs text-slate-500">Hourly Live Requests</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {liveRuntime?.workspace_requests_last_hour || 0} / {liveRuntime?.free_tier_hourly_limit || 60}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Free-tier rate guardrail</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">Total Tokens Logged</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {(liveRuntime?.total_tokens_used || 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Prompt + output tokens</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">SHA-256 Cache Hits</div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {liveRuntime?.cache_hits || 0}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Duplicate OpenRouter calls avoided</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-slate-500">Server AI Model (OpenRouter)</div>
              <div className="text-base font-bold font-mono text-slate-900 mt-1.5">
                {liveRuntime?.gemini_model || 'google/gemini-2.5-flash'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Server-side structured JSON</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">AI Processing Audit Logs ({logs.length})</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tracks discrete workflow executions, batch counts, latency, token usage, cache hits, and errors. Secrets and full customer PII are never logged.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2 px-4">Workflow</th>
                    <th className="py-2 px-4">Model</th>
                    <th className="py-2 px-3 text-right">Records</th>
                    <th className="py-2 px-3 text-right">Tokens</th>
                    <th className="py-2 px-3 text-right">Latency</th>
                    <th className="py-2 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {l.workflow_name}
                        {l.cache_hit && <span className="ml-2 text-emerald-700 font-normal">(Cache hit)</span>}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500">{l.model_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{l.records_count}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {(l.prompt_tokens + l.output_tokens).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">{l.latency_ms}ms</td>
                      <td
                        className={`py-2.5 px-4 whitespace-nowrap ${
                          l.status === 'success' ? 'text-emerald-700 font-medium' : 'text-red-700 font-semibold'
                        }`}
                      >
                        {l.status}
                        {l.error_message && (
                          <div className="text-[11px] font-normal text-red-600 max-w-xs truncate">{l.error_message}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SUPABASE POSTGRESQL & SERVER ARCHITECTURE (Read-Only — ZERO API key inputs!) */}
      {tab === 'architecture' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">Backend Storage & Security Posture</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  All credentials live exclusively in server-side environment variables (<span className="font-mono">.env</span> / Secrets panel) and are never exposed to browser bundles or UI forms.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
              <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
                <div className="font-semibold text-slate-900">Database Runtime Mode</div>
                <div className="text-slate-700">
                  {liveRuntime?.supabase_configured
                    ? 'Connected to Supabase PostgreSQL via server-side environment variables.'
                    : 'Running on Persistent Local SQLite Mirror (data/voc-copilot.db) implementing the identical 10-table PostgreSQL schema.'}
                </div>
                <div className="text-slate-500 pt-1">
                  To connect your existing Supabase project, set <span className="font-mono">SUPABASE_URL</span>,{' '}
                  <span className="font-mono">SUPABASE_ANON_KEY</span>, and{' '}
                  <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> in your server environment and apply the SQL migration below.
                </div>
              </div>

              <div className="p-4 border border-slate-200 rounded-lg space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Privacy & Server-Side AI Isolation</span>
                </div>
                <div className="text-slate-700">
                  OpenRouter Server Status:{' '}
                  <span className={liveRuntime?.gemini_configured ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                    {liveRuntime?.gemini_configured ? 'Active (server-side OPENROUTER_API_KEY detected)' : 'Awaiting server-side OPENROUTER_API_KEY in Secrets'}
                  </span>
                </div>
                <div className="text-slate-500 pt-1">
                  Email addresses, phone numbers, and ID patterns are redacted server-side before every OpenRouter workflow call. Row Level Security policies enforce strict workspace isolation across all 10 tables.
                </div>
              </div>
            </div>
          </div>

          {/* Copyable PostgreSQL Migration Viewer */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Supabase PostgreSQL Schema Migration (10 Tables + Indexes + RLS)
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  supabase/migrations/001_initial_schema.sql
                </div>
              </div>
              <button
                type="button"
                onClick={copySql}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'Copied SQL' : 'Copy Migration SQL'}</span>
              </button>
            </div>
            <pre className="p-5 text-[11px] font-mono text-slate-700 bg-slate-50/70 overflow-x-auto max-h-96 leading-relaxed">
              {schemaSql}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
