import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Check, Building2, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { Profile, Workspace, RuntimeStatus } from '../../shared/types';

interface AuthOnboardingModalProps {
  mode: 'login' | 'register' | 'new-workspace';
  onClose?: () => void;
  canClose?: boolean;
  onAuthenticated: (payload: {
    token: string;
    user: Profile;
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
    runtime?: RuntimeStatus;
  }) => void;
  onWorkspaceCreated?: (workspace: Workspace, workspaces: Workspace[]) => void;
}

const INDUSTRIES = [
  'SaaS',
  'FinTech',
  'HealthTech',
  'E-Commerce & Retail',
  'Developer Tools',
  'Marketplace',
  'EdTech',
  'Consulting & Services',
];

const BUSINESS_TYPES = ['B2B', 'B2C', 'B2B2C', 'Enterprise Software', 'PLG / Self-Serve'];

const ROLES = [
  'Product Manager',
  'Head of Product / VP Product',
  'Startup Founder / CEO',
  'Business Owner',
  'Customer Success Lead',
  'UX Research Lead',
];

const OBJECTIVES = [
  'Improve customer retention',
  'Accelerate onboarding & activation',
  'Prioritise product roadmap with evidence',
  'Reduce support escalation volume',
  'Prepare executive & board insights',
];

export const AuthOnboardingModal: React.FC<AuthOnboardingModalProps> = ({
  mode: initialMode,
  onClose,
  canClose = true,
  onAuthenticated,
  onWorkspaceCreated,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'new-workspace'>(initialMode);
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setStep(1);
    setError(null);
  }, [initialMode]);

  // Account fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  // Workspace onboarding fields
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('SaaS');
  const [businessType, setBusinessType] = useState('B2B');
  const [userRole, setUserRole] = useState('Product Manager');
  const [primaryObjective, setPrimaryObjective] = useState('Improve customer retention');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        user: Profile;
        workspaces: Workspace[];
        active_workspace_id: string | null;
        runtime: RuntimeStatus;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated({
        token: res.token,
        user: res.user,
        workspaces: res.workspaces,
        activeWorkspaceId: res.active_workspace_id,
        runtime: res.runtime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoAccess() {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        user: Profile;
        workspaces: Workspace[];
        active_workspace_id: string | null;
        runtime: RuntimeStatus;
      }>('/api/auth/demo-session', { method: 'POST' });
      onAuthenticated({
        token: res.token,
        user: res.user,
        workspaces: res.workspaces,
        activeWorkspaceId: res.active_workspace_id,
        runtime: res.runtime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open demo workspace.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) {
      if (!fullName.trim() || !email.trim() || password.length < 8) {
        setError('Enter your name, valid email, and a password of at least 8 characters.');
        return;
      }
      setError(null);
      setStep(2);
      return;
    }

    if (!companyName.trim()) {
      setError('Enter your company or workspace name.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        token: string;
        user: Profile;
        workspaces: Workspace[];
        active_workspace_id: string | null;
        runtime: RuntimeStatus;
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          role_title: userRole,
          workspace: {
            company_name: companyName,
            industry,
            business_type: businessType,
            user_role: userRole,
            primary_objective: primaryObjective,
          },
        }),
      });
      onAuthenticated({
        token: res.token,
        user: res.user,
        workspaces: res.workspaces,
        activeWorkspaceId: res.active_workspace_id,
        runtime: res.runtime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      setError('Company or workspace name is required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ workspace: Workspace; workspaces: Workspace[] }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          company_name: companyName,
          name: companyName,
          industry,
          business_type: businessType,
          user_role: userRole,
          primary_objective: primaryObjective,
        }),
      });
      onWorkspaceCreated?.(res.workspace, res.workspaces);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 backdrop-blur-[2px] p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 my-auto">
        {canClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute top-4 right-4 z-10 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Left Editorial Column */}
        <div className="lg:col-span-5 bg-[#F8FAFC] border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between p-7">
          <div>
            <div className="text-xs font-semibold tracking-wide text-blue-700 mb-2">
              Voice of Customer Copilot
            </div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 leading-snug text-balance">
              Don&apos;t just analyse customer feedback. Know what to do next.
            </h2>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Every pain point theme, potential churn signal, and RICE opportunity stays linked to exact verbatim customer quotes inside isolated workspaces.
            </p>
          </div>

          <div className="my-6 rounded-lg overflow-hidden border border-slate-200/80 bg-white aspect-video">
            {!heroImgFailed ? (
              <img
                src="/src/assets/images/onboarding_workspace_hero_1794945862231.jpg"
                alt="Architectural prism representing structured customer intelligence"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-50 text-slate-500 text-xs font-medium">
                Listen · Understand · Prioritise · Act
              </div>
            )}
          </div>

          <div className="space-y-2.5 text-xs text-slate-600">
            <div className="flex items-start gap-2.5">
              <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>Workspace-level data isolation with Row Level Security schema</span>
            </div>
            <div className="flex items-start gap-2.5">
              <Check className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>6 separate server-side OpenRouter AI workflows with strict JSON schemas</span>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>Evidence-first governance — zero invented customer quotes</span>
            </div>
          </div>
        </div>

        {/* Right Interactive Form Column */}
        <div className="lg:col-span-7 p-7 sm:p-8 flex flex-col justify-center">
          {mode !== 'new-workspace' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setStep(1);
                  setError(null);
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account & Workspace
              </button>
            </div>
          )}

          {mode === 'new-workspace' && (
            <div className="mb-6">
              <div className="flex items-center gap-2 text-blue-700 text-xs font-medium mb-1">
                <Building2 className="w-3.5 h-3.5" />
                <span>Isolated Workspace Setup</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900">Create a new workspace</h3>
              <p className="text-sm text-slate-600 mt-1">
                Feedback records, pain point themes, RICE opportunities, and reports remain strictly isolated per workspace.
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
              {error}
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Work Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleDemoAccess}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors whitespace-nowrap"
                >
                  Open Acme Demo (100 records)
                </button>
              </div>

              <p className="text-xs text-slate-500 pt-2">
                Demo credentials: <span className="font-mono text-slate-700">alex.morgan@acmetech.io</span> /{' '}
                <span className="font-mono text-slate-700">DemoPass2026!</span>
              </p>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="flex items-center gap-3 text-xs text-slate-500 pb-1 border-b border-slate-200">
                <span className={step === 1 ? 'text-blue-700 font-semibold' : 'text-slate-500'}>
                  01. Account Credentials
                </span>
                <span aria-hidden="true">/</span>
                <span className={step === 2 ? 'text-blue-700 font-semibold' : 'text-slate-500'}>
                  02. Workspace Context & Objective
                </span>
              </div>

              {step === 1 ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jordan Rivera"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Work Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jordan@company.com"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Password (min 8 characters)</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a secure password"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <span>Continue to Workspace Setup</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Company / Workspace Name</label>
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="e.g. Acme Technologies"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Industry</label>
                      <select
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                      >
                        {INDUSTRIES.map((i) => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Business Type</label>
                      <select
                        value={businessType}
                        onChange={(e) => setBusinessType(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                      >
                        {BUSINESS_TYPES.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Your Role</label>
                      <select
                        value={userRole}
                        onChange={(e) => setUserRole(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">Primary Objective</label>
                      <select
                        value={primaryObjective}
                        onChange={(e) => setPrimaryObjective(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                      >
                        {OBJECTIVES.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="pt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      <span>{loading ? 'Creating workspace...' : 'Launch Workspace'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </form>
          )}

          {mode === 'new-workspace' && (
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Company / Workspace Name</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Northstar Analytics"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Industry</label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {INDUSTRIES.map((i) => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Business Type</label>
                  <select
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {BUSINESS_TYPES.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Your Role</label>
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Primary Business Objective</label>
                  <select
                    value={primaryObjective}
                    onChange={(e) => setPrimaryObjective(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {OBJECTIVES.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3">
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <span>{loading ? 'Creating...' : 'Create Isolated Workspace'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
