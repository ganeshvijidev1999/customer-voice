import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  LayoutDashboard,
  Inbox,
  Compass,
  HeartPulse,
  AlertOctagon,
  SlidersHorizontal,
  CheckSquare,
  FileBarChart2,
  Settings,
  Search,
  Bell,
  HelpCircle,
  ChevronDown,
  Plus,
  LogOut,
  Menu,
  X,
  UserPlus,
  ArrowLeft,
} from 'lucide-react';
import {
  apiRequest,
  getStoredToken,
  setStoredToken,
  getStoredWorkspaceId,
  setStoredWorkspaceId,
} from './lib/api';
import { LandingPage } from './components/LandingPage';
import { AuthOnboardingModal } from './components/AuthOnboardingModal';
import { EmptyWorkspaceOnboarding } from './components/EmptyWorkspaceOnboarding';
import { OverviewView } from './views/OverviewView';
import { FeedbackInboxView } from './views/FeedbackInboxView';
import { PainPointExplorerView } from './views/PainPointExplorerView';
import { SentimentView } from './views/SentimentView';
import { ChurnSignalsView } from './views/ChurnSignalsView';
import { PrioritisationView } from './views/PrioritisationView';
import { ActionPlansView } from './views/ActionPlansView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import type { Profile, Workspace, DashboardMetrics, RuntimeStatus } from '../shared/types';

type NavTab =
  | 'overview'
  | 'inbox'
  | 'explorer'
  | 'sentiment'
  | 'churn'
  | 'prioritisation'
  | 'actions'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inbox', label: 'Feedback Inbox', icon: Inbox },
  { id: 'explorer', label: 'Pain Point Explorer', icon: Compass },
  { id: 'sentiment', label: 'Customer Sentiment', icon: HeartPulse },
  { id: 'churn', label: 'Churn Signals', icon: AlertOctagon },
  { id: 'prioritisation', label: 'Prioritisation', icon: SlidersHorizontal },
  { id: 'actions', label: 'Action Plans', icon: CheckSquare },
  { id: 'reports', label: 'Reports', icon: FileBarChart2 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface SearchResults {
  feedback: Array<{ id: string; feedback_id: string; customer_text: string; customer_segment: string }>;
  themes: Array<{ id: string; title: string; severity: string; frequency: number }>;
  opportunities: Array<{ id: string; title: string; rice_score: number; priority: string }>;
  action_plans: Array<{ id: string; title: string; status: string; owner: string }>;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  target_tab: string;
  timestamp: string;
}

function getInitialAuthModalFromPath(): 'login' | 'register' | null {
  if (typeof window === 'undefined') return null;
  const p = window.location.pathname.toLowerCase();
  if (p === '/login') return 'login';
  if (p === '/signup' || p === '/register') return 'register';
  return null;
}

function syncUrlPath(targetPath: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== targetPath) {
    window.history.replaceState(null, '', targetPath);
  }
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<Profile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Onboarding sub-view override (lets user inspect uploaded rows in Feedback Inbox before analysis)
  const [onboardingSubView, setOnboardingSubView] = useState<'onboarding' | 'inbox'>('onboarding');

  // Landing demo CTA state
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Top bar popovers & modals
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'new-workspace' | null>(
    getInitialAuthModalFromPath
  );
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Global search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Real workspace notifications
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;

  const bootstrapSession = useCallback(async () => {
    setBooting(true);
    try {
      const token = getStoredToken();
      if (token) {
        try {
          const me = await apiRequest<{ user: Profile; workspaces: Workspace[]; runtime: RuntimeStatus }>(
            '/api/auth/me'
          );
          setUser(me.user);
          setWorkspaces(me.workspaces);
          setRuntime(me.runtime);
          const storedWs = getStoredWorkspaceId();
          const validWs = me.workspaces.find((w) => w.id === storedWs)?.id || me.workspaces[0]?.id || null;
          setActiveWorkspaceId(validWs);
          if (validWs) setStoredWorkspaceId(validWs);
          setAuthModalMode(null);
          return;
        } catch {
          setStoredToken(null);
          setStoredWorkspaceId(null);
        }
      }
      // Unauthenticated visitors land on the Public Landing Page instead of auto-loading demo data
      setUser(null);
      setWorkspaces([]);
      setActiveWorkspaceId(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const me = await apiRequest<{ user: Profile; workspaces: Workspace[]; runtime: RuntimeStatus }>(
        `/api/auth/me${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ''}`
      );
      setWorkspaces(me.workspaces);
      setRuntime(me.runtime);
    } catch {
      // Ignore transient refresh errors
    }
  }, [activeWorkspaceId]);

  const loadWorkspaceCore = useCallback(async (wsId: string) => {
    setMetricsLoading(true);
    try {
      const [dashRes, notifRes] = await Promise.all([
        apiRequest<{ metrics: DashboardMetrics; runtime: RuntimeStatus }>(`/api/workspaces/${wsId}/dashboard`),
        apiRequest<{ notifications: NotificationItem[] }>(`/api/workspaces/${wsId}/notifications`),
      ]);
      setMetrics(dashRes.metrics);
      setRuntime(dashRes.runtime);
      setNotifications(notifRes.notifications);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && activeWorkspace?.id) {
      void loadWorkspaceCore(activeWorkspace.id);
    }
  }, [user, activeWorkspace?.id, loadWorkspaceCore]);

  // Global search debounced fetch
  useEffect(() => {
    if (!activeWorkspace?.id || searchQuery.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      void apiRequest<SearchResults>(
        `/api/workspaces/${activeWorkspace.id}/search?q=${encodeURIComponent(searchQuery.trim())}`
      ).then((res) => {
        setSearchResults(res);
        setSearchOpen(true);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, activeWorkspace?.id]);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Derive whether the authenticated user should see New Workspace Onboarding vs Dashboard
  const analyzedCount =
    metrics && activeWorkspace && metrics.workspace.id === activeWorkspace.id
      ? metrics.summary.analyzed_feedback
      : activeWorkspace?.analyzed_count ?? 0;

  const isOnboardingRequired =
    Boolean(user) && (!activeWorkspace || (!activeWorkspace.is_demo && analyzedCount === 0));

  // Keep browser URL clean & synchronized with current route state
  useEffect(() => {
    if (booting) return;
    if (!user) {
      if (authModalMode === 'login') syncUrlPath('/login');
      else if (authModalMode === 'register') syncUrlPath('/signup');
      else syncUrlPath('/');
      return;
    }
    if (activeWorkspace?.is_demo) {
      syncUrlPath('/demo');
    } else if (isOnboardingRequired && onboardingSubView !== 'inbox') {
      syncUrlPath('/onboarding');
    } else {
      syncUrlPath('/dashboard');
    }
  }, [booting, user, authModalMode, activeWorkspace?.is_demo, isOnboardingRequired, onboardingSubView]);

  function navigateTo(tab: string, itemFocusId?: string) {
    setActiveTab(tab as NavTab);
    setFocusId(itemFocusId || null);
    setMobileMenuOpen(false);
    setSearchOpen(false);
    setNotifOpen(false);
  }

  function handleSelectWorkspace(wsId: string) {
    setActiveWorkspaceId(wsId);
    setStoredWorkspaceId(wsId);
    setWsDropdownOpen(false);
    setFocusId(null);
    setOnboardingSubView('onboarding');
    setActiveTab('overview');
  }

  async function handleExploreDemo() {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const demo = await apiRequest<{
        token: string;
        user: Profile;
        workspaces: Workspace[];
        active_workspace_id: string;
        runtime: RuntimeStatus;
      }>('/api/auth/demo-session', { method: 'POST' });

      setStoredToken(demo.token);
      setUser(demo.user);
      setWorkspaces(demo.workspaces);
      setActiveWorkspaceId(demo.active_workspace_id);
      setStoredWorkspaceId(demo.active_workspace_id);
      setRuntime(demo.runtime);
      setAuthModalMode(null);
      setOnboardingSubView('onboarding');
      setActiveTab('overview');
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Unable to open Acme Demo workspace.');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleSignOut() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    setStoredToken(null);
    setStoredWorkspaceId(null);
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setMetrics(null);
    setNotifications([]);
    setProfileMenuOpen(false);
    setWsDropdownOpen(false);
    setAuthModalMode(null);
    setOnboardingSubView('onboarding');
    setActiveTab('overview');
    syncUrlPath('/');
  }

  const handleDataChanged = useCallback(() => {
    if (activeWorkspace?.id) {
      void loadWorkspaceCore(activeWorkspace.id);
      void refreshWorkspaces();
    }
  }, [activeWorkspace?.id, loadWorkspaceCore, refreshWorkspaces]);

  const handleAnalysisComplete = useCallback(() => {
    if (activeWorkspace?.id) {
      void loadWorkspaceCore(activeWorkspace.id);
      void refreshWorkspaces();
    }
    setOnboardingSubView('onboarding');
    setActiveTab('overview');
  }, [activeWorkspace?.id, loadWorkspaceCore, refreshWorkspaces]);

  if (booting) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="text-base font-display font-bold text-slate-900">Voice of Customer Copilot</div>
          <div className="text-xs text-slate-500 mt-1">Initializing workspace intelligence...</div>
        </div>
      </div>
    );
  }

  // PUBLIC LANDING PAGE FOR UNAUTHENTICATED VISITORS (+ EXISTING AUTH MODAL ON DEMAND)
  if (!user) {
    return (
      <>
        <LandingPage
          onGetStarted={() => setAuthModalMode('register')}
          onSignIn={() => setAuthModalMode('login')}
          onExploreDemo={() => void handleExploreDemo()}
          demoLoading={demoLoading}
          demoError={demoError}
        />

        {authModalMode && (
          <AuthOnboardingModal
            mode={authModalMode}
            canClose={true}
            onClose={() => setAuthModalMode(null)}
            onAuthenticated={(payload) => {
              setStoredToken(payload.token);
              setUser(payload.user);
              setWorkspaces(payload.workspaces);
              const nextWs = payload.activeWorkspaceId || payload.workspaces[0]?.id || null;
              setActiveWorkspaceId(nextWs);
              if (nextWs) setStoredWorkspaceId(nextWs);
              if (payload.runtime) setRuntime(payload.runtime);
              setAuthModalMode(null);
              setOnboardingSubView('onboarding');
              setActiveTab('overview');
            }}
          />
        )}
      </>
    );
  }

  const totalSearchHits = searchResults
    ? searchResults.feedback.length +
      searchResults.themes.length +
      searchResults.opportunities.length +
      searchResults.action_plans.length
    : 0;

  const showSidebar = !(isOnboardingRequired && onboardingSubView === 'onboarding');

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex">
      {/* Left Fixed Enterprise Sidebar (shown in Dashboard and Feedback Inbox view) */}
      {showSidebar && (
        <aside className="no-print hidden lg:flex lg:flex-col lg:w-[248px] lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
          <div className="px-5 h-14 flex items-center border-b border-slate-200 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isOnboardingRequired) setOnboardingSubView('onboarding');
                else navigateTo('overview');
              }}
              className="text-left focus:outline-none cursor-pointer"
            >
              <div className="text-[15px] font-display font-bold tracking-tight text-slate-900 whitespace-nowrap">
                VoC Copilot
              </div>
              <div className="text-[11px] text-slate-500 leading-none mt-0.5">Know what to do next</div>
            </button>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id && !(isOnboardingRequired && onboardingSubView === 'onboarding');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (isOnboardingRequired && item.id !== 'inbox' && item.id !== 'settings') {
                      setOnboardingSubView('onboarding');
                      return;
                    }
                    navigateTo(item.id);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Quiet Workflow Footer Guide */}
          <div className="px-5 py-4 border-t border-slate-200 text-[11px] text-slate-500 space-y-1">
            <div className="font-medium text-slate-700">Decision Workflow</div>
            <div>Listen → Understand → Prioritise → Act</div>
          </div>
        </aside>
      )}

      {/* Mobile Navigation Drawer */}
      {showSidebar && mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/35" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-64 max-w-[80vw] bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="px-5 h-14 flex items-center justify-between border-b border-slate-200">
              <span className="font-display font-bold text-slate-900">VoC Copilot</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 ${showSidebar ? 'lg:pl-[248px]' : ''}`}>
        {/* Clean Enterprise Top Navigation Bar */}
        <header className="no-print sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          {/* Left: Brand (when onboarding without sidebar) + Mobile Trigger + Workspace Selector */}
          <div className="flex items-center gap-3 min-w-0">
            {showSidebar ? (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:bg-slate-100"
              >
                <Menu className="w-5 h-5" />
              </button>
            ) : (
              <div className="text-[15px] font-display font-bold tracking-tight text-slate-900 whitespace-nowrap pr-2 border-r border-slate-200">
                Voice of Customer Copilot
              </div>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setWsDropdownOpen((o) => !o)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg max-w-[230px] sm:max-w-[280px] transition-colors cursor-pointer"
              >
                <span className="truncate">{activeWorkspace?.name || 'Create Workspace'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {wsDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setWsDropdownOpen(false)} />
                  <div className="absolute left-0 mt-1.5 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1.5">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400">
                      Isolated Workspaces ({workspaces.length})
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-50">
                      {workspaces.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">No workspaces created yet.</div>
                      ) : (
                        workspaces.map((ws) => (
                          <button
                            key={ws.id}
                            type="button"
                            onClick={() => handleSelectWorkspace(ws.id)}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between gap-2 ${
                              ws.id === activeWorkspace?.id ? 'bg-blue-50/60 text-blue-800 font-semibold' : 'text-slate-700'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate">{ws.name}</div>
                              <div className="text-[11px] text-slate-400 font-normal truncate">
                                {ws.industry} · {ws.is_demo ? 'Illustrative Demo' : ws.business_type}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="border-t border-slate-200 mt-1 pt-1 px-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setWsDropdownOpen(false);
                          setAuthModalMode('new-workspace');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded-md"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create New Workspace</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Center: Functional Global Search (only when dashboard has analyzed records) */}
          {!isOnboardingRequired && (
            <div ref={searchRef} className="relative flex-1 max-w-md hidden md:block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => searchResults && setSearchOpen(true)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer quotes, pain points, opportunities..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 focus:bg-white border border-slate-200 focus:border-blue-600 rounded-lg focus:outline-none transition-colors"
              />

              {searchOpen && searchResults && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-lg shadow-xl z-30 max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
                  {totalSearchHits === 0 ? (
                    <div className="p-4 text-center text-slate-500">
                      No matching quotes, themes, or opportunities for &ldquo;{searchQuery}&rdquo;.
                    </div>
                  ) : (
                    <>
                      {searchResults.themes.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">Pain Point Themes</div>
                          {searchResults.themes.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => navigateTo('explorer', t.id)}
                              className="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded flex items-center justify-between gap-2"
                            >
                              <span className="font-medium text-slate-900 truncate">{t.title}</span>
                              <span className="font-mono text-slate-400 shrink-0">{t.frequency}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.opportunities.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">Opportunities</div>
                          {searchResults.opportunities.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => navigateTo('prioritisation', o.id)}
                              className="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded flex items-center justify-between gap-2"
                            >
                              <span className="font-medium text-slate-900 truncate">{o.title}</span>
                              <span className="font-mono text-blue-700 shrink-0">RICE {o.rice_score}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.feedback.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">Verbatim Feedback</div>
                          {searchResults.feedback.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => navigateTo('inbox', f.id)}
                              className="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded block"
                            >
                              <div className="text-slate-800 line-clamp-1">&ldquo;{f.customer_text}&rdquo;</div>
                              <div className="text-[11px] font-mono text-slate-400">
                                {f.feedback_id} · {f.customer_segment}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchResults.action_plans.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">Action Plans</div>
                          {searchResults.action_plans.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => navigateTo('actions')}
                              className="w-full text-left px-2 py-1.5 hover:bg-slate-50 rounded flex items-center justify-between gap-2"
                            >
                              <span className="font-medium text-slate-900 truncate">{a.title}</span>
                              <span className="text-slate-400 shrink-0">{a.status}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Right: Notifications, Help, User Profile */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {/* Notifications */}
            {!isOnboardingRequired && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((o) => !o);
                    setProfileMenuOpen(false);
                  }}
                  aria-label="Workspace notifications"
                  className="relative p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-600" />
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                    <div className="absolute right-0 mt-1.5 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-20 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-slate-200 text-xs font-semibold text-slate-900">
                        Workspace Activity & Alerts ({notifications.length})
                      </div>
                      <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="p-4 text-xs text-slate-500 text-center">No active alerts.</div>
                        ) : (
                          notifications.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => navigateTo(n.target_tab)}
                              className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                            >
                              <div className="text-xs font-semibold text-slate-900">{n.title}</div>
                              <div className="text-xs text-slate-600 mt-0.5 leading-snug">{n.detail}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Help Drawer Trigger */}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Product workflow guide"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {/* User Profile Dropdown */}
            <div className="relative pl-1">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((o) => !o);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                {user.avatar_url && !avatarFailed ? (
                  <img
                    src={user.avatar_url}
                    alt={user.full_name}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="w-7 h-7 rounded-full object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
                    {user.full_name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="hidden sm:inline text-xs font-medium text-slate-800 whitespace-nowrap">
                  {user.full_name}
                </span>
              </button>

              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-lg shadow-xl z-20 py-1.5 text-xs">
                    <div className="px-3.5 py-2 border-b border-slate-100">
                      <div className="font-semibold text-slate-900">{user.full_name}</div>
                      <div className="text-slate-500 font-mono text-[11px] truncate">{user.email}</div>
                      {user.role_title && <div className="text-slate-400 mt-0.5">{user.role_title}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setAuthModalMode('new-workspace');
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5 text-slate-400" />
                      <span>New Workspace</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setAuthModalMode('register');
                      }}
                      className="w-full text-left px-3.5 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-slate-400" />
                      <span>Create Own Account</span>
                    </button>
                    <div className="border-t border-slate-100 mt-1 pt-1">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full text-left px-3.5 py-2 hover:bg-red-50 text-red-700 flex items-center gap-2"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Clearly Labelled Demo Environment Banner */}
        {activeWorkspace?.is_demo && (
          <div className="no-print bg-indigo-50/80 border-b border-indigo-200 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-indigo-950">
              <span className="font-semibold">Demo Workspace</span>
              <span className="mx-2 text-indigo-300">·</span>
              <span>
                Viewing illustrative sample data for {activeWorkspace.company_name}
                {typeof activeWorkspace.feedback_count === 'number' && activeWorkspace.feedback_count > 0
                  ? ` (${activeWorkspace.feedback_count} seeded records)`
                  : ' (sample dataset)'}
                , isolated from real user accounts.
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setAuthModalMode('register')}
                className="font-medium text-indigo-800 hover:text-indigo-950 underline underline-offset-4 whitespace-nowrap cursor-pointer"
              >
                Create Own Account
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="px-3 py-1 font-medium text-indigo-900 bg-white border border-indigo-200 hover:bg-indigo-100/60 rounded-md whitespace-nowrap cursor-pointer"
              >
                Exit Demo
              </button>
            </div>
          </div>
        )}

        {/* Active View Viewport */}
        <main className="flex-1 p-5 sm:p-7 max-w-[1360px] w-full mx-auto">
          {isOnboardingRequired ? (
            onboardingSubView === 'inbox' && activeWorkspace ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-xs">
                  <span className="text-slate-600">
                    Inspecting uploaded records before launching your dashboard.
                  </span>
                  <button
                    type="button"
                    onClick={() => setOnboardingSubView('onboarding')}
                    className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Return to Onboarding</span>
                  </button>
                </div>
                <FeedbackInboxView
                  workspaceId={activeWorkspace.id}
                  runtime={runtime}
                  onDataChanged={handleDataChanged}
                  focusRecordId={focusId}
                />
              </div>
            ) : (
              <EmptyWorkspaceOnboarding
                workspace={activeWorkspace}
                runtime={runtime}
                onCreateWorkspace={() => setAuthModalMode('new-workspace')}
                onFeedbackImported={handleDataChanged}
                onAnalysisComplete={handleAnalysisComplete}
                onOpenFeedbackInbox={() => {
                  setOnboardingSubView('inbox');
                  setActiveTab('inbox');
                }}
              />
            )
          ) : activeWorkspace ? (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  metrics={metrics}
                  runtime={runtime}
                  loading={metricsLoading}
                  onNavigate={navigateTo}
                />
              )}
              {activeTab === 'inbox' && (
                <FeedbackInboxView
                  workspaceId={activeWorkspace.id}
                  runtime={runtime}
                  onDataChanged={handleDataChanged}
                  focusRecordId={focusId}
                />
              )}
              {activeTab === 'explorer' && (
                <PainPointExplorerView
                  workspaceId={activeWorkspace.id}
                  focusThemeId={focusId}
                  onDataChanged={handleDataChanged}
                  onNavigate={navigateTo}
                />
              )}
              {activeTab === 'sentiment' && (
                <SentimentView
                  workspaceId={activeWorkspace.id}
                  metrics={metrics}
                  onDataChanged={handleDataChanged}
                />
              )}
              {activeTab === 'churn' && (
                <ChurnSignalsView
                  workspaceId={activeWorkspace.id}
                  onDataChanged={handleDataChanged}
                  onNavigate={navigateTo}
                />
              )}
              {activeTab === 'prioritisation' && (
                <PrioritisationView
                  workspaceId={activeWorkspace.id}
                  focusOpportunityId={focusId}
                  onDataChanged={handleDataChanged}
                  onNavigate={navigateTo}
                />
              )}
              {activeTab === 'actions' && (
                <ActionPlansView
                  workspaceId={activeWorkspace.id}
                  onDataChanged={handleDataChanged}
                />
              )}
              {activeTab === 'reports' && <ReportsView workspaceId={activeWorkspace.id} />}
              {activeTab === 'settings' && (
                <SettingsView
                  workspace={activeWorkspace}
                  runtime={runtime}
                  onWorkspaceUpdated={(ws, allWs) => {
                    setWorkspaces(allWs);
                    setActiveWorkspaceId(ws.id);
                    handleDataChanged();
                  }}
                />
              )}
            </>
          ) : null}
        </main>
      </div>

      {/* Help & Workflow Guide Drawer */}
      {helpOpen && (
        <div className="no-print fixed inset-0 z-50 flex justify-end bg-slate-950/35">
          <div className="w-full max-w-md bg-white h-full border-l border-slate-200 shadow-xl flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">How Voice of Customer Copilot Works</h3>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-600 leading-relaxed">
              <div>
                <div className="font-semibold text-slate-900 text-sm">01. Listen (Feedback Inbox)</div>
                <p className="mt-1">
                  Upload CSVs, paste multiple verbatims, or log individual interviews. Every import runs field validation and SHA-256 duplicate detection without silently discarding rows.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900 text-sm">02. Understand (6 Server-Side OpenRouter AI Workflows)</div>
                <p className="mt-1">
                  Separate workflows handle Classification, Sentiment, Theme Detection, Severity & Potential Churn Signals, Verbatim Evidence Mapping, and Opportunity Generation in cost-controlled batches.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900 text-sm">03. Prioritise (Dynamic RICE Engine)</div>
                <p className="mt-1">
                  Review evidence-backed opportunities, adjust Reach, Impact, Confidence, and Effort live, and treat AI outputs strictly as advisory suggestions for PM review.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900 text-sm">04. Act (Action Plans & Executive Reports)</div>
                <p className="mt-1">
                  Convert prioritised opportunities into owned Action Plans and print or save a 9-section Executive Report directly to PDF backed by real workspace records.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth / Register / New Workspace Modal */}
      {authModalMode && (
        <AuthOnboardingModal
          mode={authModalMode}
          canClose={true}
          onClose={() => setAuthModalMode(null)}
          onAuthenticated={(payload) => {
            setStoredToken(payload.token);
            setUser(payload.user);
            setWorkspaces(payload.workspaces);
            const nextWs = payload.activeWorkspaceId || payload.workspaces[0]?.id || null;
            setActiveWorkspaceId(nextWs);
            if (nextWs) setStoredWorkspaceId(nextWs);
            if (payload.runtime) setRuntime(payload.runtime);
            setAuthModalMode(null);
            setOnboardingSubView('onboarding');
            setActiveTab('overview');
          }}
          onWorkspaceCreated={(ws, allWs) => {
            setWorkspaces(allWs);
            setActiveWorkspaceId(ws.id);
            setStoredWorkspaceId(ws.id);
            setOnboardingSubView('onboarding');
            setActiveTab('overview');
          }}
        />
      )}
    </div>
  );
}

export default App;
