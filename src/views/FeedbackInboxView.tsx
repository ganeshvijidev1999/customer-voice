import React, { useEffect, useState, useCallback } from 'react';
import Papa from 'papaparse';
import {
  Upload,
  Plus,
  ClipboardPaste,
  Play,
  RotateCcw,
  Download,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Clock,
  Trash2,
} from 'lucide-react';
import {
  apiRequest,
  sentimentTextClass,
  severityTextClass,
  formatShortDate,
  SAMPLE_UPLOAD_CSV,
} from '../lib/api';
import type {
  FeedbackRecord,
  AnalysisJob,
  CsvImportSummary,
  RuntimeStatus,
  SentimentType,
  SeverityLevel,
} from '../../shared/types';

interface FeedbackInboxViewProps {
  workspaceId: string;
  runtime: RuntimeStatus | null;
  onDataChanged: () => void;
  focusRecordId?: string | null;
}

type InboxSubTab = 'records' | 'csv' | 'manual' | 'paste' | 'integrations';

const TARGET_FIELDS = [
  { key: 'feedback_id', label: 'Feedback ID', required: false },
  { key: 'customer_text', label: 'Customer Text', required: true },
  { key: 'source', label: 'Feedback Source', required: false },
  { key: 'feedback_date', label: 'Date', required: false },
  { key: 'customer_segment', label: 'Customer Segment', required: false },
  { key: 'customer_id', label: 'Customer ID', required: false },
  { key: 'product_area', label: 'Product Area', required: false },
] as const;

const FUTURE_INTEGRATIONS = [
  {
    category: 'Customer Support Platforms',
    examples: 'Zendesk, Intercom, Freshdesk, Front',
    description: 'Scheduled ingestion of solved/escalated tickets with automatic PII stripping before classification.',
  },
  {
    category: 'App Store & Review Platforms',
    examples: 'Apple App Store, Google Play, G2, Trustpilot',
    description: 'Continuous ingestion of public reviews tagged by app version and rating.',
  },
  {
    category: 'Survey & NPS Platforms',
    examples: 'Typeform, Delighted, Qualtrics, SurveyMonkey',
    description: 'Direct webhook capture of open-ended NPS verbatims and post-onboarding surveys.',
  },
  {
    category: 'CRM & Revenue Systems',
    examples: 'Salesforce, HubSpot, Gong Call Notes',
    description: 'Sync account segment and expansion/renewal context while maintaining strict workspace isolation.',
  },
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

export const FeedbackInboxView: React.FC<FeedbackInboxViewProps> = ({
  workspaceId,
  runtime,
  onDataChanged,
  focusRecordId,
}) => {
  const [subTab, setSubTab] = useState<InboxSubTab>('records');
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('All');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Detail & Manual Correction Drawer
  const [selectedRecord, setSelectedRecord] = useState<FeedbackRecord | null>(null);
  const [editSentiment, setEditSentiment] = useState<SentimentType>('Neutral');
  const [editSeverity, setEditSeverity] = useState<SeverityLevel>('Low');
  const [editCategory, setEditCategory] = useState('');
  const [editProductArea, setEditProductArea] = useState('');
  const [editChurnSignal, setEditChurnSignal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // CSV Upload Workflow
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importingCsv, setImportingCsv] = useState(false);
  const [importSummary, setImportSummary] = useState<CsvImportSummary | null>(null);

  // Manual Entry Form
  const [manualText, setManualText] = useState('');
  const [manualFeedbackId, setManualFeedbackId] = useState('');
  const [manualSource, setManualSource] = useState('Support Ticket');
  const [manualSegment, setManualSegment] = useState('Enterprise');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualProductArea, setManualProductArea] = useState('Onboarding');
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));

  // Bulk Paste Form
  const [pasteText, setPasteText] = useState('');
  const [pasteSource, setPasteSource] = useState('Customer Interview');
  const [pasteSegment, setPasteSegment] = useState('Mid-Market');
  const [pasteProductArea, setPasteProductArea] = useState('General');

  // Pipeline Runner
  const [batchSize, setBatchSize] = useState(8);
  const [startingJob, setStartingJob] = useState(false);

  const loadInboxData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (sentimentFilter !== 'All') qs.set('sentiment', sentimentFilter);
      if (severityFilter !== 'All') qs.set('severity', severityFilter);
      if (statusFilter !== 'All') qs.set('status', statusFilter);

      const [fbRes, jobRes] = await Promise.all([
        apiRequest<{ records?: FeedbackRecord[] }>(`/api/workspaces/${workspaceId}/feedback?${qs.toString()}`),
        apiRequest<{ jobs?: AnalysisJob[] }>(`/api/workspaces/${workspaceId}/analysis/jobs`),
      ]);
      const recList = Array.isArray(fbRes?.records) ? fbRes.records : [];
      const jobList = Array.isArray(jobRes?.jobs) ? jobRes.jobs : [];
      setRecords(recList);
      setJobs(jobList);

      if (focusRecordId) {
        const match = recList.find((r) => r.id === focusRecordId || r.feedback_id === focusRecordId);
        if (match) openRecordDrawer(match);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feedback inbox.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, search, sentimentFilter, severityFilter, statusFilter, focusRecordId]);

  useEffect(() => {
    void loadInboxData();
  }, [loadInboxData]);

  // Poll actively running job every 2s
  const latestJob = jobs[0] || null;
  useEffect(() => {
    if (!latestJob || (latestJob.status !== 'running' && latestJob.status !== 'queued')) return;
    const timer = setInterval(() => {
      void apiRequest<{ jobs?: AnalysisJob[] }>(`/api/workspaces/${workspaceId}/analysis/jobs`)
        .then((res) => {
          const jobList = Array.isArray(res?.jobs) ? res.jobs : [];
          setJobs(jobList);
          const top = jobList[0];
          if (top && top.status !== 'running' && top.status !== 'queued') {
            void loadInboxData();
            onDataChanged();
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [latestJob?.id, latestJob?.status, workspaceId, loadInboxData, onDataChanged]);

  function openRecordDrawer(rec: FeedbackRecord) {
    setSelectedRecord(rec);
    setEditSentiment(rec.sentiment || 'Neutral');
    setEditSeverity(rec.severity || 'Low');
    setEditCategory(rec.category || '');
    setEditProductArea(rec.product_area || 'General');
    setEditChurnSignal(Boolean(rec.churn_signal));
  }

  async function saveManualCorrection() {
    if (!selectedRecord) return;
    setSavingEdit(true);
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/feedback/${selectedRecord.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sentiment: editSentiment,
          severity: editSeverity,
          category: editCategory,
          product_area: editProductArea,
          churn_signal: editChurnSignal,
        }),
      });
      setNotice(`Saved manual correction for ${selectedRecord.feedback_id}.`);
      setSelectedRecord(null);
      await loadInboxData();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save correction.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteRecord(record: FeedbackRecord) {
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/feedback/${record.id}`, { method: 'DELETE' });
      setSelectedRecord(null);
      setNotice(`Deleted record ${record.feedback_id}.`);
      await loadInboxData();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete feedback record.');
    }
  }

  function parseCsvString(content: string, name: string) {
    setCsvParseError(null);
    setImportSummary(null);
    setCsvFileName(name);

    const parsed = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      setCsvParseError(`Invalid CSV format: ${parsed.errors[0].message}`);
      setCsvHeaders([]);
      setCsvRows([]);
      return;
    }

    const headers = parsed.meta.fields || [];
    if (headers.length === 0 || parsed.data.length === 0) {
      setCsvParseError('CSV file has no detectable header columns or data rows.');
      setCsvHeaders([]);
      setCsvRows([]);
      return;
    }

    setCsvHeaders(headers);
    setCsvRows(parsed.data);
    setColumnMap(guessColumnMapping(headers));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setCsvParseError('File exceeds the 5 MB safety limit. Split large datasets into smaller CSV files.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      parseCsvString(String(reader.result || ''), file.name);
    };
    reader.readAsText(file);
  }

  function downloadSampleCsv() {
    const blob = new Blob([SAMPLE_UPLOAD_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voc-copilot-sample-feedback.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleConfirmCsvImport() {
    if (!columnMap.customer_text) {
      setCsvParseError('Map the required "Customer Text" column before importing.');
      return;
    }
    setImportingCsv(true);
    setCsvParseError(null);
    try {
      const mappedRecords = csvRows.map((row) => ({
        feedback_id: columnMap.feedback_id ? row[columnMap.feedback_id] : '',
        customer_text: columnMap.customer_text ? row[columnMap.customer_text] : '',
        source: columnMap.source ? row[columnMap.source] : 'CSV Upload',
        feedback_date: columnMap.feedback_date ? row[columnMap.feedback_date] : '',
        customer_segment: columnMap.customer_segment ? row[columnMap.customer_segment] : 'General',
        customer_id: columnMap.customer_id ? row[columnMap.customer_id] : '',
        product_area: columnMap.product_area ? row[columnMap.product_area] : 'General',
      }));

      const res = await apiRequest<{ summary: CsvImportSummary }>(
        `/api/workspaces/${workspaceId}/feedback/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({ records: mappedRecords, default_source: 'CSV Upload' }),
        }
      );
      setImportSummary(res.summary);
      await loadInboxData();
      onDataChanged();
    } catch (err) {
      setCsvParseError(err instanceof Error ? err.message : 'CSV import failed.');
    } finally {
      setImportingCsv(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setImportSummary(null);
    try {
      const res = await apiRequest<{ summary: CsvImportSummary }>(
        `/api/workspaces/${workspaceId}/feedback/bulk`,
        {
          method: 'POST',
          body: JSON.stringify({
            records: [
              {
                feedback_id: manualFeedbackId || undefined,
                customer_text: manualText,
                source: manualSource,
                feedback_date: manualDate,
                customer_segment: manualSegment,
                customer_id: manualCustomerId || undefined,
                product_area: manualProductArea,
              },
            ],
            default_source: manualSource,
          }),
        }
      );
      setImportSummary(res.summary);
      if (res.summary.valid_records > 0) {
        setManualText('');
        setManualFeedbackId('');
        setManualCustomerId('');
        setNotice('Saved feedback record. Run the OpenRouter AI Pipeline to classify and map evidence.');
        await loadInboxData();
        onDataChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save feedback.');
    }
  }

  async function handleBulkPasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setImportSummary(null);
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      setError('Paste at least one line of customer feedback.');
      return;
    }
    try {
      const res = await apiRequest<{ summary: CsvImportSummary }>(
        `/api/workspaces/${workspaceId}/feedback/bulk`,
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
        await loadInboxData();
        onDataChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import pasted records.');
    }
  }

  async function handleRunAnalysis(reprocessAll = false) {
    setStartingJob(true);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/analysis/run`, {
        method: 'POST',
        body: JSON.stringify({ batch_size: batchSize, reprocess_all: reprocessAll }),
      });
      setNotice('Started 6-workflow OpenRouter analysis job. Stages update live below.');
      await loadInboxData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start analysis job.');
    } finally {
      setStartingJob(false);
    }
  }

  async function handleRetryJob(jobId: string) {
    setStartingJob(true);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/analysis/jobs/${jobId}/retry`, {
        method: 'POST',
      });
      setNotice('Restarted failed analysis job on remaining pending/failed records.');
      await loadInboxData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setStartingJob(false);
    }
  }

  const pendingCount = records.filter((r) => r.processing_status === 'pending' || r.processing_status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Feedback Inbox & Ingestion</h1>
          <p className="text-sm text-slate-600 mt-1">
            Ingest CSVs, manual notes, or bulk verbatims with full duplicate & validation transparency, then orchestrate server-side OpenRouter AI workflows.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <label htmlFor="batch-size" className="whitespace-nowrap">Batch:</label>
            <select
              id="batch-size"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="font-mono text-slate-900 bg-transparent focus:outline-none"
            >
              <option value={5}>5</option>
              <option value={8}>8</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </div>
          <button
            type="button"
            disabled={startingJob || pendingCount === 0}
            onClick={() => handleRunAnalysis(false)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            <span>
              {startingJob ? 'Starting...' : `Run OpenRouter Analysis (${pendingCount} pending)`}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-700 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {notice && (
        <div className="px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-900 flex items-center justify-between gap-4">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-blue-700 hover:text-blue-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active / Latest AI Pipeline Stage Tracker */}
      {latestJob && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-900">AI Workflow Orchestration Pipeline</span>
                <span className="text-slate-400">·</span>
                <span
                  className={
                    latestJob.status === 'completed'
                      ? 'text-emerald-700 font-medium'
                      : latestJob.status === 'failed'
                      ? 'text-red-700 font-semibold'
                      : 'text-blue-700 font-medium'
                  }
                >
                  {latestJob.status === 'running' ? 'Running live' : latestJob.status.toUpperCase()}
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {latestJob.processed_records} / {latestJob.total_records} records processed
                </span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-slate-500">Batch size {latestJob.batch_size}</span>
              </div>
              {latestJob.error_message && (
                <p className="text-xs text-red-700 mt-1.5 leading-relaxed">{latestJob.error_message}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {latestJob.status === 'failed' && (
                <button
                  type="button"
                  disabled={startingJob}
                  onClick={() => handleRetryJob(latestJob.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restart Failed Job</span>
                </button>
              )}
              <span className="text-[11px] font-mono text-slate-400">
                {runtime?.gemini_configured ? `OpenRouter live (${runtime.gemini_model})` : 'OpenRouter key pending in server Secrets'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-9 gap-2.5 pt-4">
            {latestJob.stages.map((st, idx) => (
              <div key={st.key} className="text-xs">
                <div className="flex items-center gap-1.5 mb-1">
                  {st.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                  {st.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0" />}
                  {st.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                  {(st.status === 'pending' || st.status === 'skipped') && (
                    <Clock className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  )}
                  <span className="font-mono text-[11px] text-slate-400">0{idx + 1}</span>
                </div>
                <div className="font-medium text-slate-800 leading-tight">{st.label}</div>
                {st.detail && <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{st.detail}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Segmented View Controls */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(
          [
            { id: 'records', label: `All Records (${records.length})` },
            { id: 'csv', label: 'Upload CSV' },
            { id: 'manual', label: 'Manual Entry' },
            { id: 'paste', label: 'Paste Multiple' },
            { id: 'integrations', label: 'Future Integrations' },
          ] as Array<{ id: InboxSubTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setSubTab(tab.id);
              setImportSummary(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Shared Import Transparency Summary (never silently discards rows) */}
      {importSummary && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Import Validation Summary — Status:{' '}
                <span
                  className={
                    importSummary.import_status === 'completed'
                      ? 'text-emerald-700'
                      : importSummary.import_status === 'partial'
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }
                >
                  {importSummary.import_status.toUpperCase()}
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Every row is accounted for. Duplicates and invalid entries are explicitly itemized below.
              </p>
            </div>
            {importSummary.valid_records > 0 && (
              <button
                type="button"
                disabled={startingJob}
                onClick={() => handleRunAnalysis(false)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Analyze {importSummary.valid_records} Saved Records with OpenRouter</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg">
            <div className="p-3.5">
              <div className="text-xs text-slate-500">Total Records</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {importSummary.total_records}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-xs text-slate-500">Valid & Saved</div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                {importSummary.valid_records}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-xs text-slate-500">Duplicates Skipped</div>
              <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-0.5">
                {importSummary.duplicate_records}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-xs text-slate-500">Invalid Records</div>
              <div className="text-lg font-bold font-mono tabular-nums text-red-700 mt-0.5">
                {importSummary.invalid_records}
              </div>
            </div>
          </div>

          {importSummary.duplicates.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-amber-800 mb-1.5">
                Duplicate Records Detected ({importSummary.duplicates.length})
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                {importSummary.duplicates.map((d, i) => (
                  <div key={i} className="px-3.5 py-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="font-mono text-slate-500">Row {d.row_index} ({d.feedback_id})</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="text-slate-700">{d.preview}</span>
                    </div>
                    <span className="text-amber-700 shrink-0">{d.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importSummary.invalids.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-red-800 mb-1.5">
                Invalid Records Flagged ({importSummary.invalids.length})
              </div>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                {importSummary.invalids.map((inv, i) => (
                  <div key={i} className="px-3.5 py-2 flex items-start justify-between gap-4">
                    <div>
                      <span className="font-mono text-slate-500">Row {inv.row_index} ({inv.feedback_id})</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="text-slate-700">{inv.preview}</span>
                    </div>
                    <span className="text-red-700 shrink-0">{inv.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: ALL FEEDBACK RECORDS TABLE */}
      {subTab === 'records' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search quotes, Feedback ID, customer reference..."
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <select
              value={sentimentFilter}
              onChange={(e) => setSentimentFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="All">All Sentiments</option>
              <option value="Positive">Positive</option>
              <option value="Negative">Negative</option>
              <option value="Neutral">Neutral</option>
              <option value="Mixed">Mixed</option>
              <option value="Uncertain">Uncertain</option>
            </select>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="All">All Severities</option>
              <option value="High">High Severity</option>
              <option value="Medium">Medium Severity</option>
              <option value="Low">Low Severity</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="All">All Statuses</option>
              <option value="completed">Analyzed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {loading ? (
            <div className="p-10 text-center text-xs text-slate-500">Loading feedback records...</div>
          ) : records.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-800">No feedback records match the current filter</p>
              <p className="text-xs text-slate-500 mt-1">Upload a CSV, enter feedback manually, or clear your filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-4">ID & Date</th>
                    <th className="py-2.5 px-4">Customer Verbatim</th>
                    <th className="py-2.5 px-4">Segment · Source</th>
                    <th className="py-2.5 px-4">Sentiment</th>
                    <th className="py-2.5 px-4">Severity</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {records.map((rec) => (
                    <tr
                      key={rec.id}
                      onClick={() => openRecordDrawer(rec)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap align-top">
                        <div className="font-mono font-medium text-slate-900">{rec.feedback_id}</div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">{rec.feedback_date}</div>
                      </td>
                      <td className="py-3 px-4 max-w-md align-top">
                        <div className="text-slate-900 leading-relaxed line-clamp-2">{rec.customer_text}</div>
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center flex-wrap gap-1.5">
                          <span>{rec.product_area}</span>
                          {rec.theme_title && (
                            <>
                              <span>·</span>
                              <span className="text-blue-700">{rec.theme_title}</span>
                            </>
                          )}
                          {rec.churn_signal && (
                            <>
                              <span>·</span>
                              <span className="text-red-700 font-medium">Potential churn signal</span>
                            </>
                          )}
                          {rec.human_corrected && (
                            <>
                              <span>·</span>
                              <span className="text-indigo-700">Human reviewed</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top text-slate-600">
                        <div>{rec.customer_segment}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{rec.source}</div>
                      </td>
                      <td className={`py-3 px-4 whitespace-nowrap align-top ${sentimentTextClass(rec.sentiment)}`}>
                        {rec.sentiment || 'Pending'}
                      </td>
                      <td className={`py-3 px-4 whitespace-nowrap align-top ${severityTextClass(rec.severity)}`}>
                        {rec.severity || 'Pending'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap align-top text-slate-500 capitalize">
                        {rec.processing_status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CSV UPLOAD -> PREVIEW -> MAP -> VALIDATE -> SAVE */}
      {subTab === 'csv' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">CSV Feedback Upload & Column Mapping</h2>
              <p className="text-xs text-slate-500 mt-1">
                Upload CSV → Preview rows → Map schema columns → Detect duplicates & invalid rows → Save valid records. Max 5 MB / 2,000 rows per batch.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={downloadSampleCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download CSV Template</span>
              </button>
              <button
                type="button"
                onClick={() => parseCsvString(SAMPLE_UPLOAD_CSV, 'sample-with-duplicates-and-errors.csv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Load Test CSV (with duplicates & errors)</span>
              </button>
            </div>
          </div>

          <label className="block border border-dashed border-slate-300 hover:border-blue-500 rounded-lg p-8 text-center cursor-pointer transition-colors bg-slate-50/50">
            <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-800">
              {csvFileName ? `Selected file: ${csvFileName} (${csvRows.length} rows parsed)` : 'Choose a CSV file from your computer'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Supports Feedback ID, Customer Text, Source, Date, Customer Segment, Customer ID, Product Area
            </div>
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          </label>

          {csvParseError && (
            <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
              {csvParseError}
            </div>
          )}

          {csvHeaders.length > 0 && (
            <>
              <div>
                <h3 className="text-xs font-semibold text-slate-900 mb-3">Step 2. Map CSV Columns</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {TARGET_FIELDS.map((field) => (
                    <div key={field.key}>
                      <label className="block text-xs text-slate-600 mb-1">
                        {field.label} {field.required && <span className="text-red-600">*</span>}
                      </label>
                      <select
                        value={columnMap[field.key] || ''}
                        onChange={(e) => setColumnMap((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">— Not mapped —</option>
                        {csvHeaders.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-900 mb-2">
                  Step 3. Preview First {Math.min(5, csvRows.length)} of {csvRows.length} Parsed Rows
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        {csvHeaders.map((h) => (
                          <th key={h} className="py-2 px-3 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvRows.slice(0, 5).map((row, idx) => (
                        <tr key={idx}>
                          {csvHeaders.map((h) => (
                            <td key={h} className="py-2 px-3 text-slate-700 max-w-xs truncate">
                              {row[h] || <span className="text-slate-400 italic">(empty)</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCsvHeaders([]);
                    setCsvRows([]);
                    setCsvFileName('');
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Clear File
                </button>
                <button
                  type="button"
                  disabled={importingCsv}
                  onClick={handleConfirmCsvImport}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  <span>{importingCsv ? 'Validating & Saving...' : `Validate & Import ${csvRows.length} Rows`}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: MANUAL ENTRY */}
      {subTab === 'manual' && (
        <form onSubmit={handleManualSubmit} className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Manual Customer Feedback Entry</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Log individual customer discovery notes, support escalations, or executive call quotes directly into this workspace.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Customer Verbatim Feedback *</label>
            <textarea
              required
              rows={4}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Enter exact original customer wording (never paraphrase so evidence stays verbatim)..."
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Feedback ID (optional)</label>
              <input
                type="text"
                value={manualFeedbackId}
                onChange={(e) => setManualFeedbackId(e.target.value)}
                placeholder="Auto-generated"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Source</label>
              <select
                value={manualSource}
                onChange={(e) => setManualSource(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option>Support Ticket</option>
                <option>In-App Survey</option>
                <option>Sales Call</option>
                <option>Intercom Chat</option>
                <option>G2 Review</option>
                <option>NPS Comment</option>
                <option>Manual Entry</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Customer Segment</label>
              <select
                value={manualSegment}
                onChange={(e) => setManualSegment(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option>Enterprise</option>
                <option>Mid-Market</option>
                <option>SMB</option>
                <option>Startup</option>
                <option>Self-Serve</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Customer ID (optional)</label>
              <input
                type="text"
                value={manualCustomerId}
                onChange={(e) => setManualCustomerId(e.target.value)}
                placeholder="e.g. CUST-512"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Product Area</label>
              <input
                type="text"
                value={manualProductArea}
                onChange={(e) => setManualProductArea(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save Feedback Record</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: BULK PASTE */}
      {subTab === 'paste' && (
        <form onSubmit={handleBulkPasteSubmit} className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Paste Multiple Feedback Records</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter one customer feedback comment per line. Duplicates and empty/invalid lines are automatically detected and reported.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Default Source</label>
              <input
                type="text"
                value={pasteSource}
                onChange={(e) => setPasteSource(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Default Segment</label>
              <select
                value={pasteSegment}
                onChange={(e) => setPasteSegment(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option>Enterprise</option>
                <option>Mid-Market</option>
                <option>SMB</option>
                <option>Startup</option>
                <option>Self-Serve</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Default Product Area</label>
              <input
                type="text"
                value={pasteProductArea}
                onChange={(e) => setPasteProductArea(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">One Record Per Line *</label>
            <textarea
              required
              rows={7}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"We couldn't find how to invite read-only stakeholders during setup.\nThe quarterly dashboard took 14 seconds to load this morning.\nLoving the verbatim quotes inside the executive PDF report."}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Validate & Save Pasted Records</span>
          </button>
        </form>
      )}

      {/* TAB 5: PLANNED FUTURE INTEGRATIONS (Explicitly Non-Active) */}
      {subTab === 'integrations' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Planned Ingestion Connectors (Roadmap — Not Active)</h2>
            <p className="text-xs text-slate-600 mt-1">
              Active ingestion today uses CSV Upload, Manual Entry, and Bulk Paste. The external connectors below are architectural roadmap items and are intentionally inactive so no fake sync state is simulated.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FUTURE_INTEGRATIONS.map((item) => (
              <div key={item.category} className="p-4 border border-slate-200 rounded-lg bg-slate-50/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{item.category}</div>
                  <span className="text-[11px] font-mono text-slate-500">Planned · Inactive</span>
                </div>
                <div className="text-xs text-blue-700 mt-1">{item.examples}</div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Right-Side Inspection & Human Correction Drawer */}
      {selectedRecord && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30">
          <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 shadow-xl flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {selectedRecord.feedback_id} · {formatShortDate(selectedRecord.feedback_date)}
                </div>
                <h3 className="text-base font-semibold text-slate-900 mt-0.5">Feedback Record Inspector</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1.5">Original Verbatim Customer Quote</div>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 leading-relaxed">
                  &ldquo;{selectedRecord.customer_text}&rdquo;
                </div>
                <div className="mt-2 text-xs text-slate-500 flex items-center flex-wrap gap-2">
                  <span>Source: {selectedRecord.source}</span>
                  <span>·</span>
                  <span>Segment: {selectedRecord.customer_segment}</span>
                  {selectedRecord.customer_id && (
                    <>
                      <span>·</span>
                      <span className="font-mono">Customer: {selectedRecord.customer_id}</span>
                    </>
                  )}
                </div>
              </div>

              {/* AI Diagnostic Reasoning */}
              <div className="pt-4 border-t border-slate-200 space-y-3 text-xs">
                <div className="font-semibold text-slate-900">AI Classification & Reasoning</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-slate-500">Customer Intent</div>
                    <div className="font-medium text-slate-800 mt-0.5">{selectedRecord.customer_intent || 'Pending'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Confidence</div>
                    <div className="font-mono font-medium text-slate-800 mt-0.5">
                      {selectedRecord.classification_confidence
                        ? `${Math.round(selectedRecord.classification_confidence * 100)}%`
                        : '—'}
                    </div>
                  </div>
                </div>
                {selectedRecord.sentiment_reasoning && (
                  <div>
                    <div className="text-slate-500">Sentiment Reasoning</div>
                    <div className="text-slate-700 mt-0.5 leading-relaxed">{selectedRecord.sentiment_reasoning}</div>
                  </div>
                )}
                {selectedRecord.severity_reasoning && (
                  <div>
                    <div className="text-slate-500">Severity Reasoning (Decoupled from Tone)</div>
                    <div className="text-slate-700 mt-0.5 leading-relaxed">{selectedRecord.severity_reasoning}</div>
                  </div>
                )}
              </div>

              {/* Manual Human-in-the-Loop Correction */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="text-xs font-semibold text-slate-900">Manual Review & Correction</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Sentiment</label>
                    <select
                      value={editSentiment}
                      onChange={(e) => setEditSentiment(e.target.value as SentimentType)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="Positive">Positive</option>
                      <option value="Negative">Negative</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Mixed">Mixed</option>
                      <option value="Uncertain">Uncertain</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Severity</label>
                    <select
                      value={editSeverity}
                      onChange={(e) => setEditSeverity(e.target.value as SeverityLevel)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Category</label>
                    <input
                      type="text"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">Product Area</label>
                    <input
                      type="text"
                      value={editProductArea}
                      onChange={(e) => setEditProductArea(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 pt-1">
                  <input
                    type="checkbox"
                    checked={editChurnSignal}
                    onChange={(e) => setEditChurnSignal(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Flag as Potential churn signal</span>
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleDeleteRecord(selectedRecord)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 hover:text-red-800"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Record</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={saveManualCorrection}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {savingEdit ? 'Saving...' : 'Save Human Correction'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
