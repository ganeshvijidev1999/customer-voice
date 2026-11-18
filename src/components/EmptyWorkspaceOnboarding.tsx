import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Papa from 'papaparse';
import {
  Upload,
  ClipboardPaste,
  Plus,
  Download,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  RotateCcw,
  FileSpreadsheet,
  Inbox,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  Workspace,
  CsvImportSummary,
  AnalysisJob,
  RuntimeStatus,
  FeedbackRecord,
} from '../../shared/types';

interface EmptyWorkspaceOnboardingProps {
  workspace: Workspace | null;
  runtime: RuntimeStatus | null;
  onCreateWorkspace: () => void;
  onFeedbackImported: () => void;
  onAnalysisComplete: () => void;
  onOpenFeedbackInbox?: () => void;
}

type IntakeOption = 'csv' | 'paste' | 'manual';

const TARGET_FIELDS = [
  { key: 'customer_text', label: 'Customer Feedback Text', required: true },
  { key: 'source', label: 'Source', required: false },
  { key: 'feedback_date', label: 'Date', required: false },
  { key: 'customer_segment', label: 'Customer Segment', required: false },
  { key: 'product_area', label: 'Product Area', required: false },
  { key: 'customer_id', label: 'Customer ID', required: false },
  { key: 'feedback_id', label: 'Feedback ID', required: false },
] as const;

const SOURCE_OPTIONS = [
  'Support Ticket',
  'Customer Interview',
  'In-App Survey',
  'NPS Survey',
  'G2 / App Review',
  'Intercom Chat',
  'Sales Call Notes',
  'CSV Upload',
];

const SEGMENT_OPTIONS = ['Enterprise', 'Mid-Market', 'SMB', 'Startup', 'Self-Serve', 'General'];

const PRODUCT_AREA_OPTIONS = [
  'General',
  'Onboarding',
  'Performance',
  'Billing & Pricing',
  'Analytics & Reports',
  'Integrations & Exports',
  'Search & Filtering',
  'Permissions & Security',
];

const WORKFLOW_STEPS = [
  { key: 'LISTEN', detail: 'Ingest CSVs, interviews, or individual records' },
  { key: 'UNDERSTAND', detail: 'Cluster themes, sentiment, severity & evidence' },
  { key: 'PRIORITISE', detail: 'Score opportunities with Reach, Impact, Confidence, Effort' },
  { key: 'ACT', detail: 'Create owned action plans & executive reports' },
];

function guessColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerHeaders = headers.map((h) => ({ raw: h, lower: h.toLowerCase().trim() }));

  const findMatch = (patterns: string[], exclude: string[] = []) => {
    const candidates = lowerHeaders.filter((h) => !exclude.includes(h.raw));
    for (const p of patterns) {
      const exact = candidates.find((h) => h.lower === p);
      if (exact) return exact.raw;
    }
    for (const p of patterns) {
      const partial = candidates.find((h) => h.lower.includes(p));
      if (partial) return partial.raw;
    }
    return '';
  };

  mapping.feedback_id = findMatch(['feedback_id', 'feedback id', 'ticket_id', 'record_id', 'id']);
  const used = () => Object.values(mapping).filter(Boolean);
  mapping.customer_text = findMatch(
    ['customer_text', 'feedback_text', 'verbatim', 'comment', 'review', 'message', 'quote', 'text', 'body', 'feedback'],
    used()
  );
  mapping.source = findMatch(['source', 'channel', 'origin'], used());
  mapping.feedback_date = findMatch(['feedback_date', 'created_at', 'date', 'created', 'timestamp'], used());
  mapping.customer_segment = findMatch(['customer_segment', 'segment', 'tier', 'plan'], used());
  mapping.customer_id = findMatch(['customer_id', 'account_id', 'user_id', 'account', 'customer'], used());
  mapping.product_area = findMatch(['product_area', 'product', 'area', 'module', 'feature'], used());
  return mapping;
}

function isDateStringValid(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true; // backend defaults empty date to today
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    return !Number.isNaN(d.getTime());
  }
  const d = new Date(trimmed);
  return !Number.isNaN(d.getTime());
}

export const EmptyWorkspaceOnboarding: React.FC<EmptyWorkspaceOnboardingProps> = ({
  workspace,
  runtime,
  onCreateWorkspace,
  onFeedbackImported,
  onAnalysisComplete,
  onOpenFeedbackInbox,
}) => {
  const [activeOption, setActiveOption] = useState<IntakeOption>('csv');
  const [existingRecords, setExistingRecords] = useState<FeedbackRecord[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // CSV State
  const [csvFileName, setCsvFileName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [csvError, setCsvError] = useState<string | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);

  // Paste Interviews State
  const [pasteText, setPasteText] = useState('');
  const [pasteSource, setPasteSource] = useState('Customer Interview');
  const [pasteSegment, setPasteSegment] = useState('Mid-Market');
  const [pasteProductArea, setPasteProductArea] = useState('General');
  const [importingPaste, setImportingPaste] = useState(false);

  // Manual Entry State
  const [manualText, setManualText] = useState('');
  const [manualSource, setManualSource] = useState('Support Ticket');
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualSegment, setManualSegment] = useState('Enterprise');
  const [manualProductArea, setManualProductArea] = useState('General');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [importingManual, setImportingManual] = useState(false);

  // Shared Import Summary & Pipeline State
  const [importSummary, setImportSummary] = useState<CsvImportSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [analysisTriggeredHere, setAnalysisTriggeredHere] = useState(false);

  const loadWorkspaceStatus = useCallback(async () => {
    if (!workspace?.id) return;
    setLoadingStatus(true);
    try {
      const [fbRes, jobRes] = await Promise.all([
        apiRequest<{ records?: FeedbackRecord[] }>(`/api/workspaces/${workspace.id}/feedback`),
        apiRequest<{ jobs?: AnalysisJob[] }>(`/api/workspaces/${workspace.id}/analysis/jobs`),
      ]);
      setExistingRecords(Array.isArray(fbRes?.records) ? fbRes.records : []);
      setJobs(Array.isArray(jobRes?.jobs) ? jobRes.jobs : []);
    } catch {
      // Non-fatal on initial check
    } finally {
      setLoadingStatus(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    setImportSummary(null);
    setActionError(null);
    setActionNotice(null);
    setCsvError(null);
    setCsvRows([]);
    setCsvHeaders([]);
    setCsvFileName('');
    setAnalysisTriggeredHere(false);
    void loadWorkspaceStatus();
  }, [workspace?.id, loadWorkspaceStatus]);

  const latestJob = jobs[0] || null;
  const isJobActive = latestJob?.status === 'running' || latestJob?.status === 'queued';

  // Poll real OpenRouter analysis job status while active
  useEffect(() => {
    if (!workspace?.id || !isJobActive) return;
    const timer = setInterval(() => {
      void apiRequest<{ jobs?: AnalysisJob[] }>(`/api/workspaces/${workspace.id}/analysis/jobs`)
        .then((res) => {
          const list = Array.isArray(res?.jobs) ? res.jobs : [];
          setJobs(list);
          const top = list[0];
          if (top && top.status !== 'running' && top.status !== 'queued') {
            void loadWorkspaceStatus();
            if (top.status === 'completed' || (top.status === 'partial' && top.processed_records > 0)) {
              onAnalysisComplete();
            }
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [workspace?.id, isJobActive, loadWorkspaceStatus, onAnalysisComplete]);

  // Client-side pre-import validation & duplicate inspection for CSV preview
  const csvInspection = useMemo(() => {
    if (csvRows.length === 0) return null;
    const mapped = csvRows.map((row, idx) => {
      const customer_text = (columnMap.customer_text ? row[columnMap.customer_text] || '' : '').trim();
      const feedback_id = (columnMap.feedback_id ? row[columnMap.feedback_id] || '' : '').trim();
      const source = (columnMap.source ? row[columnMap.source] || '' : '').trim() || 'CSV Upload';
      const feedback_date = (columnMap.feedback_date ? row[columnMap.feedback_date] || '' : '').trim();
      const customer_segment = (columnMap.customer_segment ? row[columnMap.customer_segment] || '' : '').trim() || 'General';
      const customer_id = (columnMap.customer_id ? row[columnMap.customer_id] || '' : '').trim();
      const product_area = (columnMap.product_area ? row[columnMap.product_area] || '' : '').trim() || 'General';
      return {
        rowNumber: idx + 1,
        feedback_id,
        customer_text,
        source,
        feedback_date,
        customer_segment,
        customer_id,
        product_area,
      };
    });

    const seenTexts = new Set(existingRecords.map((r) => r.customer_text.trim().toLowerCase()));
    const seenIds = new Set(existingRecords.map((r) => r.feedback_id.trim().toLowerCase()));
    let missingTextCount = 0;
    let invalidDateCount = 0;
    let duplicateCount = 0;
    let readyCount = 0;

    const annotated = mapped.map((item) => {
      let status: 'Ready' | 'Missing text' | 'Invalid date' | 'Duplicate' = 'Ready';
      const normText = item.customer_text.toLowerCase();
      const normId = item.feedback_id.toLowerCase();

      if (!item.customer_text || item.customer_text.length < 5) {
        status = 'Missing text';
        missingTextCount++;
      } else if (!isDateStringValid(item.feedback_date)) {
        status = 'Invalid date';
        invalidDateCount++;
      } else if ((normId && seenIds.has(normId)) || seenTexts.has(normText)) {
        status = 'Duplicate';
        duplicateCount++;
      } else {
        readyCount++;
        seenTexts.add(normText);
        if (normId) seenIds.add(normId);
      }

      return { ...item, status };
    });

    return {
      total: mapped.length,
      readyCount,
      missingTextCount,
      invalidDateCount,
      duplicateCount,
      mapped,
      preview: annotated.slice(0, 5),
    };
  }, [csvRows, columnMap, existingRecords]);

  function handleCsvFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    setActionError(null);
    setActionNotice(null);
    setImportSummary(null);

    if (!file.name.toLowerCase().endsWith('.csv') && file.type && !file.type.includes('csv') && !file.type.includes('text')) {
      setCsvError('Please choose a valid .csv file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCsvError('File exceeds the 5 MB upload limit. Please split large exports into smaller files.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const parsed = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: true,
      });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        setCsvError(`Invalid CSV format: ${parsed.errors[0].message}`);
        setCsvHeaders([]);
        setCsvRows([]);
        return;
      }

      const headers = parsed.meta.fields || [];
      if (headers.length === 0 || parsed.data.length === 0) {
        setCsvError('The selected CSV file has no detectable header columns or feedback rows.');
        setCsvHeaders([]);
        setCsvRows([]);
        return;
      }

      setCsvFileName(file.name);
      setCsvHeaders(headers);
      setCsvRows(parsed.data);
      setColumnMap(guessColumnMapping(headers));
    };
    reader.readAsText(file);
  }

  function handleDownloadBlankTemplate() {
    const templateCsv = [
      'feedback_id,customer_text,source,feedback_date,customer_segment,customer_id,product_area',
      'FB-001,"Replace with your customer feedback quote or support note.",Support Ticket,' +
        new Date().toISOString().slice(0, 10) +
        ',Enterprise,CUST-001,Onboarding',
    ].join('\n');
    const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voc-copilot-feedback-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleConfirmCsvImport() {
    if (!workspace?.id) return;
    if (!columnMap.customer_text) {
      setCsvError('Map the required "Customer Feedback Text" column before importing.');
      return;
    }
    if (!csvInspection || csvInspection.mapped.length === 0) {
      setCsvError('No rows available to import.');
      return;
    }

    setImportingCsv(true);
    setCsvError(null);
    setActionError(null);
    setActionNotice(null);

    try {
      const res = await apiRequest<{ summary: CsvImportSummary }>(
        `/api/workspaces/${workspace.id}/feedback/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({
            records: csvInspection.mapped.map((r) => ({
              feedback_id: r.feedback_id || undefined,
              customer_text: r.customer_text,
              source: r.source || 'CSV Upload',
              feedback_date: r.feedback_date || undefined,
              customer_segment: r.customer_segment || 'General',
              customer_id: r.customer_id || undefined,
              product_area: r.product_area || 'General',
            })),
            default_source: 'CSV Upload',
          }),
        }
      );
      setImportSummary(res.summary);
      if (res.summary.valid_records > 0) {
        setActionNotice(
          `Successfully imported ${res.summary.valid_records} feedback record${res.summary.valid_records === 1 ? '' : 's'} from ${csvFileName}.`
        );
        await loadWorkspaceStatus();
        onFeedbackImported();
      } else {
        setActionError('No valid new records were imported. Review the validation details below.');
      }
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Failed to import CSV rows.');
    } finally {
      setImportingCsv(false);
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace?.id) return;
    setActionError(null);
    setActionNotice(null);
    setImportSummary(null);

    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setActionError('Paste at least one customer feedback message or interview line.');
      return;
    }

    setImportingPaste(true);
    try {
      const res = await apiRequest<{ summary: CsvImportSummary }>(
        `/api/workspaces/${workspace.id}/feedback/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({
            records: lines.map((line) => ({
              customer_text: line,
              source: pasteSource,
              customer_segment: pasteSegment,
              product_area: pasteProductArea,
            })),
            default_source: pasteSource,
          }),
        }
      );
      setImportSummary(res.summary);
      if (res.summary.valid_records > 0) {
        setPasteText('');
        setActionNotice(
          `Imported ${res.summary.valid_records} customer feedback message${res.summary.valid_records === 1 ? '' : 's'}.`
        );
        await loadWorkspaceStatus();
        onFeedbackImported();
      } else {
        setActionError('No valid new feedback records were imported. Check the warnings below.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save pasted feedback.');
    } finally {
      setImportingPaste(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace?.id) return;
    setActionError(null);
    setActionNotice(null);
    setImportSummary(null);

    if (manualText.trim().length < 5) {
      setActionError('Enter at least 5 characters of customer feedback text.');
      return;
    }

    setImportingManual(true);
    try {
      const res = await apiRequest<{ summary: CsvImportSummary }>(
        `/api/workspaces/${workspace.id}/feedback/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({
            records: [
              {
                customer_text: manualText.trim(),
                source: manualSource,
                feedback_date: manualDate,
                customer_segment: manualSegment,
                product_area: manualProductArea,
                customer_id: manualCustomerId.trim() || undefined,
              },
            ],
            default_source: manualSource,
          }),
        }
      );
      setImportSummary(res.summary);
      if (res.summary.valid_records > 0) {
        setManualText('');
        setManualCustomerId('');
        setActionNotice('Feedback record added to your workspace.');
        await loadWorkspaceStatus();
        onFeedbackImported();
      } else {
        setActionError('The feedback record could not be saved. Check the validation details below.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save feedback record.');
    } finally {
      setImportingManual(false);
    }
  }

  async function handleRunAnalysis() {
    if (!workspace?.id) return;
    setStartingAnalysis(true);
    setActionError(null);
    setAnalysisTriggeredHere(true);
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/analysis/run`, {
        method: 'POST',
        body: JSON.stringify({ batch_size: 8, reprocess_all: false }),
      });
      await loadWorkspaceStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to start AI analysis.');
    } finally {
      setStartingAnalysis(false);
    }
  }

  async function handleRetryAnalysis(jobId: string) {
    if (!workspace?.id) return;
    setStartingAnalysis(true);
    setActionError(null);
    setAnalysisTriggeredHere(true);
    try {
      await apiRequest(`/api/workspaces/${workspace.id}/analysis/jobs/${jobId}/retry`, {
        method: 'POST',
      });
      await loadWorkspaceStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setStartingAnalysis(false);
    }
  }

  const pendingRecordsCount = existingRecords.filter(
    (r) => r.processing_status === 'pending' || r.processing_status === 'failed'
  ).length;
  const totalUploadedCount = existingRecords.length;

  // No workspace exists yet for this account
  if (!workspace) {
    return (
      <div className="max-w-3xl mx-auto py-8 sm:py-14 space-y-8">
        <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-10">
          <div className="text-xs font-semibold text-blue-700 mb-2">Workspace Setup</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Your customer insights start here.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
            Upload your customer feedback and let AI uncover the problems, patterns and opportunities hidden in your data.
          </p>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <p className="text-sm text-slate-700 mb-5">
              Create your first isolated workspace so your customer feedback, AI themes, and executive reports remain strictly separated.
            </p>
            <button
              type="button"
              onClick={onCreateWorkspace}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Your First Workspace</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1040px] mx-auto py-2 sm:py-4 space-y-7">
      {/* Header & Workflow Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="max-w-2xl">
          <div className="text-xs font-medium text-blue-700 mb-2">
            {workspace.name} · New Workspace Onboarding
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            Your customer insights start here.
          </h1>
          <p className="mt-2.5 text-sm sm:text-base text-slate-600 leading-relaxed">
            Upload your customer feedback and let AI uncover the problems, patterns and opportunities hidden in your data.
          </p>
        </div>

        {/* 4-Stage Workflow */}
        <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {WORKFLOW_STEPS.map((step, idx) => (
            <div key={step.key} className="space-y-1">
              <div className="text-[11px] font-mono font-semibold text-blue-700">
                0{idx + 1}. {step.key}
              </div>
              <div className="text-xs text-slate-600 leading-relaxed">{step.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Primary CTA Banner when user already has pending records ready for AI analysis */}
      {(totalUploadedCount > 0 || importSummary) && (
        <section className="bg-white border border-blue-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-blue-700">
                Ready for AI Understanding
              </div>
              <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5 tabular-nums">
                {totalUploadedCount} feedback record{totalUploadedCount === 1 ? '' : 's'} in workspace
                {pendingRecordsCount > 0 ? ` (${pendingRecordsCount} pending analysis)` : ''}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Runs server-side OpenRouter workflows ({runtime?.gemini_model || 'google/gemini-2.5-flash'}) to detect themes, sentiment, severity, churn signals, verbatim evidence, and RICE opportunities.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {pendingRecordsCount > 0 && (
                <button
                  type="button"
                  disabled={startingAnalysis || isJobActive}
                  onClick={handleRunAnalysis}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {startingAnalysis || isJobActive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>{isJobActive ? 'Analysing Feedback...' : 'Analyse My Feedback'}</span>
                </button>
              )}

              {onOpenFeedbackInbox && totalUploadedCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenFeedbackInbox}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Inbox className="w-3.5 h-3.5" />
                  <span>Inspect in Feedback Inbox</span>
                </button>
              )}
            </div>
          </div>

          {/* Live Analysis Job Progress (real backend stages — never simulated) */}
          {latestJob && (analysisTriggeredHere || isJobActive || latestJob.status === 'failed') && (
            <div className="border-t border-slate-200 pt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-medium text-slate-900">
                  Analysis Pipeline Status:{' '}
                  <span
                    className={
                      latestJob.status === 'completed'
                        ? 'text-emerald-700 font-semibold'
                        : latestJob.status === 'failed'
                        ? 'text-red-700 font-semibold'
                        : 'text-blue-700 font-semibold'
                    }
                  >
                    {latestJob.status.toUpperCase()}
                  </span>
                </div>
                <div className="font-mono tabular-nums text-slate-600">
                  {latestJob.processed_records} / {latestJob.total_records} records processed
                  {latestJob.failed_records > 0 ? ` · ${latestJob.failed_records} failed` : ''}
                </div>
              </div>

              {latestJob.error_message && (
                <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">AI Analysis encountered an error</div>
                      <div className="mt-0.5 text-red-800">{latestJob.error_message}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetryAnalysis(latestJob.id)}
                    disabled={startingAnalysis || isJobActive}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-800 bg-white border border-red-300 hover:bg-red-100/50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Analysis</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                {latestJob.stages.map((stage) => (
                  <div
                    key={stage.key}
                    className="px-3 py-2.5 rounded-lg border border-slate-200 bg-[#F8FAFC] flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{stage.label}</div>
                      {stage.detail && (
                        <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{stage.detail}</div>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-mono shrink-0 ${
                        stage.status === 'completed'
                          ? 'text-emerald-700 font-semibold'
                          : stage.status === 'running'
                          ? 'text-blue-700 font-semibold'
                          : stage.status === 'failed'
                          ? 'text-red-700 font-semibold'
                          : 'text-slate-400'
                      }`}
                    >
                      {stage.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Feedback Intake Selector + Workspace */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Three Primary Intake Options */}
        <div className="border-b border-slate-200 bg-[#F8FAFC] p-4 sm:px-6 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setActiveOption('csv');
              setActionError(null);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeOption === 'csv'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Upload CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveOption('paste');
              setActionError(null);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeOption === 'paste'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ClipboardPaste className="w-4 h-4" />
            <span>Paste Customer Feedback</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveOption('manual');
              setActionError(null);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeOption === 'manual'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Add Feedback</span>
          </button>

          {loadingStatus && (
            <span className="ml-auto text-xs text-slate-400 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Checking workspace...</span>
            </span>
          )}
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {actionError && (
            <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}

          {actionNotice && (
            <div className="px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{actionNotice}</span>
            </div>
          )}

          {/* OPTION 1: CSV UPLOAD */}
          {activeOption === 'csv' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Import Customer Feedback CSV
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    Upload a CSV export from your support desk, survey tool, or CRM. Preview rows, map columns, and inspect duplicates before confirming import.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadBlankTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CSV Template</span>
                </button>
              </div>

              <label className="block border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition-colors bg-[#F8FAFC]/60">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvFileSelected}
                  className="sr-only"
                />
                <FileSpreadsheet className="w-7 h-7 text-blue-600 mx-auto mb-2.5" />
                <div className="text-sm font-semibold text-slate-900">
                  {csvFileName ? `Selected: ${csvFileName}` : 'Choose a CSV file to upload'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Supports UTF-8 .csv files up to 5 MB (max 2,000 rows per import)
                </div>
              </label>

              {csvError && (
                <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{csvError}</span>
                </div>
              )}

              {/* Column Mapping & Validation Preview */}
              {csvHeaders.length > 0 && csvInspection && (
                <div className="space-y-6 border-t border-slate-200 pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">1. Column Mapping</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Match your CSV columns to Voice of Customer Copilot fields. Customer Feedback Text is required.
                    </p>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                      {TARGET_FIELDS.map((field) => (
                        <div key={field.key}>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            {field.label}{' '}
                            {field.required && <span className="text-red-600">*</span>}
                          </label>
                          <select
                            value={columnMap[field.key] || ''}
                            onChange={(e) =>
                              setColumnMap((prev) => ({ ...prev, [field.key]: e.target.value }))
                            }
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                          >
                            <option value="">— Ignore / Use Default —</option>
                            {csvHeaders.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pre-Import Missing Field & Duplicate Detection Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                      <div className="text-slate-500">Rows Detected</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                        {csvInspection.total}
                      </div>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                      <div className="text-slate-500">Ready to Import</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                        {csvInspection.readyCount}
                      </div>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                      <div className="text-slate-500">Missing / Invalid Fields</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-0.5">
                        {csvInspection.missingTextCount + csvInspection.invalidDateCount}
                      </div>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                      <div className="text-slate-500">Duplicates Found</div>
                      <div className="text-lg font-bold font-mono tabular-nums text-slate-700 mt-0.5">
                        {csvInspection.duplicateCount}
                      </div>
                    </div>
                  </div>

                  {/* Data Preview Table */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        2. Data Preview (First {csvInspection.preview.length} of {csvInspection.total} rows)
                      </h3>
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-[#F8FAFC] border-b border-slate-200 text-slate-600">
                            <th className="py-2.5 px-3 font-semibold">#</th>
                            <th className="py-2.5 px-3 font-semibold">Feedback Text</th>
                            <th className="py-2.5 px-3 font-semibold">Source</th>
                            <th className="py-2.5 px-3 font-semibold">Segment</th>
                            <th className="py-2.5 px-3 font-semibold">Date</th>
                            <th className="py-2.5 px-3 font-semibold">Validation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {csvInspection.preview.map((row) => (
                            <tr key={row.rowNumber}>
                              <td className="py-2.5 px-3 font-mono text-slate-500 tabular-nums">
                                {row.rowNumber}
                              </td>
                              <td className="py-2.5 px-3 text-slate-900 max-w-xs truncate">
                                {row.customer_text || <span className="text-red-600 italic">(empty)</span>}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{row.source}</td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {row.customer_segment}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                                {row.feedback_date || 'Today'}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={
                                    row.status === 'Ready'
                                      ? 'text-emerald-700 font-medium'
                                      : row.status === 'Duplicate'
                                      ? 'text-amber-700 font-medium'
                                      : 'text-red-700 font-semibold'
                                  }
                                >
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Confirm Import Button + Progress */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                    <div className="text-xs text-slate-500">
                      Duplicates and invalid rows are safely skipped and listed in your import summary.
                    </div>
                    <button
                      type="button"
                      disabled={importingCsv || !columnMap.customer_text}
                      onClick={handleConfirmCsvImport}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {importingCsv ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      <span>
                        {importingCsv
                          ? 'Importing CSV Records...'
                          : `Confirm & Import ${csvInspection.total} Rows`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* OPTION 2: PASTE INTERVIEWS */}
          {activeOption === 'paste' && (
            <form onSubmit={handlePasteSubmit} className="space-y-5">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Paste Customer Feedback or Interview Notes
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Paste multiple customer responses, survey verbatims, or support excerpts — one message per line.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Default Source</label>
                  <select
                    value={pasteSource}
                    onChange={(e) => setPasteSource(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Customer Segment</label>
                  <select
                    value={pasteSegment}
                    onChange={(e) => setPasteSegment(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {SEGMENT_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Product Area</label>
                  <select
                    value={pasteProductArea}
                    onChange={(e) => setPasteProductArea(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {PRODUCT_AREA_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Customer Messages (one feedback record per line)
                </label>
                <textarea
                  rows={7}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={
                    'Example:\nSetup stalled when our security admin tried adding read-only reviewers.\nThe weekly PDF summary saves our PM team hours before executive reviews.\nSearch does not match partial ticket numbers when filtering invoices.'
                  }
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={importingPaste}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {importingPaste ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ClipboardPaste className="w-4 h-4" />
                  )}
                  <span>{importingPaste ? 'Saving Feedback...' : 'Paste Customer Feedback'}</span>
                </button>
              </div>
            </form>
          )}

          {/* OPTION 3: MANUAL ENTRY */}
          {activeOption === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-5">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Enter Individual Customer Feedback
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Log a single customer interview note, support ticket, or sales call observation with metadata.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Feedback Text <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Enter exact verbatim customer feedback..."
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Source</label>
                  <select
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Customer Segment</label>
                  <select
                    value={manualSegment}
                    onChange={(e) => setManualSegment(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {SEGMENT_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Product Area</label>
                  <select
                    value={manualProductArea}
                    onChange={(e) => setManualProductArea(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  >
                    {PRODUCT_AREA_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Customer ID (optional)
                  </label>
                  <input
                    type="text"
                    value={manualCustomerId}
                    onChange={(e) => setManualCustomerId(e.target.value)}
                    placeholder="e.g. ACCT-412"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={importingManual}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {importingManual ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>{importingManual ? 'Adding Feedback...' : 'Add Feedback'}</span>
                </button>
              </div>
            </form>
          )}

          {/* STRUCTURED IMPORT SUMMARY (SHOWN AFTER UPLOAD) */}
          {importSummary && (
            <div className="border-t border-slate-200 pt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Import Summary</h3>
                <span
                  className={`text-xs font-medium ${
                    importSummary.import_status === 'completed'
                      ? 'text-emerald-700'
                      : importSummary.import_status === 'partial'
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}
                >
                  Status: {importSummary.import_status.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                  <div className="text-slate-500">Total Uploaded</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {importSummary.total_records}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                  <div className="text-slate-500">Successfully Imported</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                    {importSummary.valid_records}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                  <div className="text-slate-500">Failed / Invalid</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-red-700 mt-0.5">
                    {importSummary.invalid_records}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 bg-[#F8FAFC]">
                  <div className="text-slate-500">Duplicates Skipped</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-0.5">
                    {importSummary.duplicate_records}
                  </div>
                </div>
              </div>

              {(importSummary.invalids.length > 0 || importSummary.duplicates.length > 0) && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-4 space-y-2 text-xs">
                  <div className="font-semibold text-amber-900">Data Validation Warnings</div>
                  <ul className="space-y-1 text-amber-900/90 max-h-40 overflow-y-auto">
                    {importSummary.invalids.map((inv) => (
                      <li key={`inv-${inv.row_index}-${inv.feedback_id}`}>
                        Row {inv.row_index} ({inv.feedback_id}): {inv.reason}
                      </li>
                    ))}
                    {importSummary.duplicates.map((dup) => (
                      <li key={`dup-${dup.row_index}-${dup.feedback_id}`}>
                        Row {dup.row_index} ({dup.feedback_id}): {dup.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importSummary.valid_records > 0 && pendingRecordsCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-slate-600">
                    Your feedback is saved. Run AI analysis next to generate your Customer Intelligence Dashboard.
                  </div>
                  <button
                    type="button"
                    disabled={startingAnalysis || isJobActive}
                    onClick={handleRunAnalysis}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Analyse My Feedback</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
