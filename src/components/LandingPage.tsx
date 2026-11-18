import React, { useState } from 'react';
import {
  ArrowRight,
  Menu,
  X,
  Upload,
  BrainCircuit,
  Compass,
  Quote,
  HeartPulse,
  AlertOctagon,
  SlidersHorizontal,
  CheckSquare,
  FileBarChart2,
  Play,
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  onExploreDemo: () => void;
  demoLoading?: boolean;
  demoError?: string | null;
}

const STAGES = [
  {
    index: '01.',
    name: 'LISTEN',
    description:
      'Bring customer feedback together from CSV files, surveys, app reviews, support tickets and interviews.',
  },
  {
    index: '02.',
    name: 'UNDERSTAND',
    description:
      'Use AI to discover recurring themes, sentiment, severity and customer pain points, supported by original feedback evidence.',
  },
  {
    index: '03.',
    name: 'PRIORITISE',
    description:
      'Identify which customer problems deserve attention using reach, impact, confidence and effort.',
  },
  {
    index: '04.',
    name: 'ACT',
    description:
      'Convert customer insights into actionable recommendations, product improvement plans and executive reports.',
  },
];

const CAPABILITIES = [
  {
    title: 'Feedback ingestion',
    description:
      'Upload CSV exports with column mapping, paste interview notes, or log individual tickets with automatic SHA-256 duplicate detection.',
    icon: Upload,
  },
  {
    title: 'AI-powered analysis',
    description:
      'Structured server-side AI workflows classify product areas, customer intent, and core issues with PII redaction before processing.',
    icon: BrainCircuit,
  },
  {
    title: 'Pain-point discovery',
    description:
      'Cluster semantically similar customer complaints into distinct recurring themes with root-cause hypotheses and investigation prompts.',
    icon: Compass,
  },
  {
    title: 'Evidence mapping',
    description:
      'Every discovered theme links directly to exact, unaltered verbatim customer quotes and source record identifiers.',
    icon: Quote,
  },
  {
    title: 'Sentiment analysis',
    description:
      'Classify feedback across Positive, Negative, Neutral, Mixed, and Uncertain tones independently of operational severity.',
    icon: HeartPulse,
  },
  {
    title: 'Potential churn signals',
    description:
      'Flag qualitative cancellation language, repeated unresolved escalations, and billing dissatisfaction for timely team follow-up.',
    icon: AlertOctagon,
  },
  {
    title: 'RICE prioritisation',
    description:
      'Score opportunities dynamically using Reach, Impact, Confidence, and Effort so teams weigh customer evidence before committing.',
    icon: SlidersHorizontal,
  },
  {
    title: 'Action planning',
    description:
      'Convert high-priority opportunities into owned action plans with concrete next steps, expected impact, and progress tracking.',
    icon: CheckSquare,
  },
  {
    title: 'Executive reporting',
    description:
      'Generate structured, print-ready executive summaries combining volume trends, top pain points, risks, and action plans.',
    icon: FileBarChart2,
  },
];

const AUDIENCES = [
  {
    role: 'Product Managers',
    focus: 'Discovery & Roadmap Clarity',
    description:
      'Replace manual spreadsheet tagging with clustered pain points, verbatim evidence trails, and transparent RICE scoring ready for roadmap reviews.',
  },
  {
    role: 'Startup Founders',
    focus: 'Activation & Early Retention',
    description:
      'Spot onboarding blockers, recurring user friction, and early churn signals straight from customer interviews and support conversations.',
  },
  {
    role: 'Business Owners',
    focus: 'Customer Health & Focus',
    description:
      'See where customer frustration concentrates across channels and turn scattered feedback into clear operational priorities and executive briefs.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onGetStarted,
  onSignIn,
  onExploreDemo,
  demoLoading = false,
  demoError = null,
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function scrollToSection(id: string) {
    setMobileNavOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#0F172A] flex flex-col">
      {/* Top Navigation Bar — strict 3-zone contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200/90">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3 sm:gap-8">
          {/* Zone 1: Single-line Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-[15px] sm:text-[17px] font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Voice of Customer Copilot
          </a>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600" aria-label="Landing navigation">
            <a
              href="#problem"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('problem');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              The Problem
            </a>
            <a
              href="#how-it-works"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('how-it-works');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#capabilities"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('capabilities');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#who-it-helps"
              onClick={(e) => {
                e.preventDefault();
                scrollToSection('who-it-helps');
              }}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Who It Helps
            </a>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={onGetStarted}
              className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-label="Toggle navigation menu"
              className="md:hidden p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-5 py-4 space-y-2.5 text-sm font-medium text-slate-700">
            <button type="button" onClick={() => scrollToSection('problem')} className="block w-full text-left py-1.5">
              The Problem
            </button>
            <button type="button" onClick={() => scrollToSection('how-it-works')} className="block w-full text-left py-1.5">
              How It Works
            </button>
            <button type="button" onClick={() => scrollToSection('capabilities')} className="block w-full text-left py-1.5">
              Capabilities
            </button>
            <button type="button" onClick={() => scrollToSection('who-it-helps')} className="block w-full text-left py-1.5">
              Who It Helps
            </button>
            <div className="pt-2 border-t border-slate-100 flex items-center gap-4">
              <button type="button" onClick={onSignIn} className="text-sm text-blue-700 font-medium py-1">
                Sign In
              </button>
              <button type="button" onClick={onExploreDemo} className="text-sm text-indigo-700 font-medium py-1">
                Explore Demo
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* HERO SECTION */}
        <section id="top" className="relative overflow-hidden border-b border-slate-200/80 bg-gradient-to-b from-[#F8FAFC] via-white to-white">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-14 pb-16 sm:pt-20 sm:pb-24">
            <div className="max-w-3xl">
              <p className="text-xs sm:text-sm font-medium text-indigo-700 mb-4">
                Turn customer feedback into your next best product decision.
              </p>

              <h1
                className="font-display font-bold tracking-tight text-slate-900 leading-[1.08] text-balance"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)' }}
              >
                Your customers are telling you what to build next.
              </h1>

              <p className="mt-5 text-lg sm:text-xl text-slate-700 leading-relaxed max-w-2xl">
                Transform hundreds of customer conversations into evidence-backed product opportunities.
              </p>

              <p className="mt-3 text-sm sm:text-base text-slate-500 leading-relaxed max-w-2xl">
                Stop manually analysing scattered customer feedback. Discover recurring pain points, understand customer sentiment, prioritise opportunities and turn customer voices into actionable product decisions.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <button
                  type="button"
                  onClick={onGetStarted}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => scrollToSection('how-it-works')}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Explore How It Works</span>
                </button>

                <button
                  type="button"
                  disabled={demoLoading}
                  onClick={onExploreDemo}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100/80 border border-indigo-200/80 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{demoLoading ? 'Opening Demo...' : 'Explore Demo'}</span>
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={onSignIn}
                  className="font-medium text-slate-700 hover:text-blue-700 underline underline-offset-4 cursor-pointer"
                >
                  Already have an account? Sign in
                </button>
                <span aria-hidden="true">·</span>
                <span>Explore Demo opens an isolated illustrative sample workspace</span>
              </div>

              {demoError && (
                <div className="mt-4 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 max-w-xl">
                  {demoError}
                </div>
              )}
            </div>

            {/* Visual SaaS Product Preview */}
            <div className="mt-14 bg-white border border-slate-200 rounded-xl shadow-[0_12px_40px_-15px_rgba(15,23,42,0.08)] overflow-hidden">
              <div className="px-5 py-3.5 bg-[#F8FAFC] border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-medium text-slate-700">
                  Illustrative Product Preview <span className="text-slate-400">·</span>{' '}
                  <span className="text-slate-500">Customer Intelligence Workspace View</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  Listen · Understand · Prioritise · Act
                </div>
              </div>

              <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white">
                {/* Left Column: Feedback Sources + Sentiment Distribution */}
                <div className="lg:col-span-4 space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-semibold text-slate-900">Feedback Sources</h2>
                      <span className="text-[11px] font-mono text-slate-400">Sample channels</span>
                    </div>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
                      {[
                        { source: 'Support Tickets', share: '34%' },
                        { source: 'Customer Interviews', share: '24%' },
                        { source: 'In-App & NPS Surveys', share: '22%' },
                        { source: 'CSV Exports & Reviews', share: '20%' },
                      ].map((item) => (
                        <div key={item.source} className="px-3.5 py-2.5 flex items-center justify-between">
                          <span className="text-slate-700">{item.source}</span>
                          <span className="font-mono tabular-nums text-slate-500">{item.share}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-semibold text-slate-900">Sentiment Distribution</h2>
                      <span className="text-[11px] text-slate-400">Independent of severity</span>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-3.5 space-y-2.5 text-xs">
                      {[
                        { label: 'Negative', pct: 46, color: '#DC2626', text: 'text-red-700' },
                        { label: 'Positive', pct: 26, color: '#16A34A', text: 'text-emerald-700' },
                        { label: 'Mixed', pct: 15, color: '#D97706', text: 'text-amber-700' },
                        { label: 'Neutral', pct: 13, color: '#64748B', text: 'text-slate-600' },
                      ].map((row) => (
                        <div key={row.label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`font-medium ${row.text}`}>{row.label}</span>
                            <span className="font-mono tabular-nums text-slate-600">{row.pct}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-100 rounded-sm overflow-hidden">
                            <div
                              className="h-full rounded-sm"
                              style={{ width: `${row.pct}%`, backgroundColor: row.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Middle Column: AI-Detected Pain Points + Evidence-Backed Insights */}
                <div className="lg:col-span-5 space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-semibold text-slate-900">AI-Detected Pain Points</h2>
                      <span className="text-[11px] font-mono text-blue-700">Theme clustering</span>
                    </div>
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                      {[
                        {
                          title: 'Complex First-Time Workspace Setup',
                          severity: 'High',
                          sevClass: 'text-red-700 font-semibold',
                          evidence: 'Strong evidence · Enterprise, SMB',
                        },
                        {
                          title: 'Dashboard Latency on 90-Day Views',
                          severity: 'High',
                          sevClass: 'text-red-700 font-semibold',
                          evidence: 'Strong evidence · Enterprise',
                        },
                        {
                          title: 'Unclear Seat & Viewer Billing Tiers',
                          severity: 'Medium',
                          sevClass: 'text-amber-700 font-medium',
                          evidence: 'Moderate evidence · Mid-Market',
                        },
                      ].map((theme) => (
                        <div key={theme.title} className="p-3.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-medium text-slate-900">{theme.title}</span>
                            <span className={`shrink-0 ${theme.sevClass}`}>{theme.severity}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">{theme.evidence}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-semibold text-slate-900">Evidence-Backed Insights</h2>
                      <span className="text-[11px] font-mono text-slate-400">Verbatim traceability</span>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-4 bg-[#F8FAFC]/60 space-y-2 text-xs">
                      <p className="text-slate-800 leading-relaxed italic">
                        &ldquo;Onboarding stalled when we tried assigning read-only security roles to our finance reviewers before our QBR.&rdquo;
                      </p>
                      <div className="text-[11px] font-mono text-slate-500">
                        Record FB-104 · Support Ticket · Enterprise · Potential churn signal flagged
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Prioritised Opportunities */}
                <div className="lg:col-span-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-semibold text-slate-900">Prioritised Opportunities</h2>
                      <span className="text-[11px] font-mono text-indigo-700">RICE</span>
                    </div>
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                      {[
                        {
                          rank: '01.',
                          title: 'Guided Role & Workspace Checklist',
                          priority: 'P0 - Critical',
                          pClass: 'text-red-700 font-semibold',
                          rice: '288.0',
                          factors: 'R 400 · I 2.0 · C 90% · E 2.5',
                        },
                        {
                          rank: '02.',
                          title: 'Incremental 90-Day Query Rollups',
                          priority: 'P1 - High',
                          pClass: 'text-blue-700 font-semibold',
                          rice: '192.0',
                          factors: 'R 320 · I 2.0 · C 80% · E 2.7',
                        },
                        {
                          rank: '03.',
                          title: 'In-App Seat Usage Threshold Alerts',
                          priority: 'P1 - High',
                          pClass: 'text-blue-700 font-semibold',
                          rice: '144.0',
                          factors: 'R 240 · I 1.5 · C 80% · E 2.0',
                        },
                      ].map((opp) => (
                        <div key={opp.rank} className="p-3.5">
                          <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                            <span className={opp.pClass}>
                              {opp.rank} {opp.priority}
                            </span>
                            <span className="font-mono font-bold tabular-nums text-blue-700">
                              {opp.rice}
                            </span>
                          </div>
                          <div className="font-medium text-slate-900 leading-snug">{opp.title}</div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                            {opp.factors}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION A: THE PROBLEM */}
        <section id="problem" className="border-b border-slate-200/80 bg-white py-20 sm:py-24">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
            <div className="lg:col-span-5">
              <div className="text-xs font-semibold text-blue-700 mb-3">The Problem</div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 leading-tight text-balance">
                Customer feedback is scattered across multiple channels.
              </h2>
              <p className="mt-4 text-base text-slate-600 leading-relaxed">
                Teams struggle to identify patterns, understand root causes and decide what to solve first.
              </p>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-8 border-t lg:border-t-0 lg:border-l border-slate-200 pt-8 lg:pt-0 lg:pl-12">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Disconnected Channels</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Vital signals sit trapped inside support tickets, CSV survey exports, interview transcripts, and app store reviews with no shared structure.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Loudest-Voice Bias</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Without frequency counts, segment breakdowns, and verbatim evidence, recent escalations overshadow systemic product friction.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Sentiment ≠ Severity</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Calm enterprise bug reports can block renewals while vocal minor complaints look urgent—mixing tone with severity leads teams astray.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">No Clear Path to Action</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Tagging spreadsheets does not tell you which opportunities merit engineering effort next or give executives traceable proof.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION B: HOW IT WORKS (LISTEN -> UNDERSTAND -> PRIORITISE -> ACT) */}
        <section id="how-it-works" className="border-b border-slate-200/80 bg-[#F8FAFC] py-20 sm:py-24">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
            <div className="max-w-2xl mb-12">
              <div className="text-xs font-semibold text-indigo-700 mb-3">How It Works</div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Four structured stages from raw customer voices to product decisions.
              </h2>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              {STAGES.map((stage) => (
                <div key={stage.name} className="p-7 flex flex-col justify-between">
                  <div>
                    <div className="font-mono text-xs font-semibold text-blue-700 mb-3">
                      {stage.index}
                    </div>
                    <h3 className="font-display text-lg font-bold tracking-tight text-slate-900">
                      {stage.name}
                    </h3>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                      {stage.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION C: CORE CAPABILITIES */}
        <section id="capabilities" className="border-b border-slate-200/80 bg-white py-20 sm:py-24">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
            <div className="max-w-2xl mb-12">
              <div className="text-xs font-semibold text-blue-700 mb-3">Core Capabilities</div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Everything needed for evidence-backed customer intelligence.
              </h2>
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
                Every workflow keeps insights linked to exact customer records inside isolated workspaces.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {CAPABILITIES.map((cap) => {
                const Icon = cap.icon;
                return (
                  <div key={cap.title} className="bg-white p-6 sm:p-7">
                    <Icon className="w-5 h-5 text-blue-600 mb-4" />
                    <h3 className="text-base font-semibold text-slate-900">{cap.title}</h3>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed">{cap.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION D: WHO IT HELPS */}
        <section id="who-it-helps" className="border-b border-slate-200/80 bg-[#F8FAFC] py-20 sm:py-24">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
            <div className="max-w-2xl mb-12">
              <div className="text-xs font-semibold text-indigo-700 mb-3">Who It Helps</div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Built for teams accountable for what gets built next.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {AUDIENCES.map((aud) => (
                <div key={aud.role} className="bg-white border border-slate-200 rounded-xl p-7">
                  <div className="text-xs font-medium text-blue-700 mb-2">{aud.focus}</div>
                  <h3 className="font-display text-xl font-bold text-slate-900">{aud.role}</h3>
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">{aud.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION E: FINAL CTA */}
        <section className="bg-white py-20 sm:py-24">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
            <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-8 sm:p-14 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
                  Turn feedback into better product decisions.
                </h2>
                <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
                  Create your isolated workspace, upload customer feedback, and uncover evidence-backed opportunities in minutes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={onGetStarted}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Start Analysing Feedback</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={demoLoading}
                  onClick={onExploreDemo}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Explore Demo</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <span className="font-semibold text-slate-900">Voice of Customer Copilot</span>
            <span className="mx-2 text-slate-300">·</span>
            <span>Turn customer feedback into your next best product decision.</span>
          </div>
          <div className="flex items-center gap-5">
            <button type="button" onClick={onGetStarted} className="hover:text-slate-900 cursor-pointer">
              Get Started
            </button>
            <button type="button" onClick={onSignIn} className="hover:text-slate-900 cursor-pointer">
              Sign In
            </button>
            <button type="button" onClick={onExploreDemo} className="hover:text-slate-900 cursor-pointer">
              Explore Demo
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
