import type {
  SentimentType,
  SeverityLevel,
  EvidenceStrength,
  PriorityLevel,
  ActionStatus,
  ChurnConcernLevel,
} from '../../shared/types';

const TOKEN_KEY = 'voc_copilot_session_token';
const ACTIVE_WS_KEY = 'voc_copilot_active_workspace';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getStoredWorkspaceId(): string | null {
  return localStorage.getItem(ACTIVE_WS_KEY);
}

export function setStoredWorkspaceId(wsId: string | null): void {
  if (wsId) localStorage.setItem(ACTIVE_WS_KEY, wsId);
  else localStorage.removeItem(ACTIVE_WS_KEY);
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  let parseFailed = false;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parseFailed = true;
    json = { error: `Invalid server response (${res.status}).` };
  }

  if (!res.ok) {
    throw new Error(String(json?.error || `Request failed (${res.status})`));
  }
  if (parseFailed || !json || typeof json !== 'object') {
    throw new Error('Unexpected non-JSON response received from server.');
  }
  return json as T;
}

// Clean unboxed typographic color helpers (Zero-Pill discipline — never colored pills!)
export function sentimentTextClass(sentiment: SentimentType | null | undefined): string {
  switch (sentiment) {
    case 'Positive':
      return 'text-emerald-700 font-medium';
    case 'Negative':
      return 'text-red-700 font-medium';
    case 'Mixed':
      return 'text-amber-700 font-medium';
    case 'Uncertain':
      return 'text-indigo-700 font-medium';
    case 'Neutral':
    default:
      return 'text-slate-600 font-medium';
  }
}

export function severityTextClass(severity: SeverityLevel | ChurnConcernLevel | null | undefined): string {
  switch (severity) {
    case 'High':
      return 'text-red-700 font-semibold';
    case 'Medium':
      return 'text-amber-700 font-medium';
    case 'Low':
      return 'text-slate-600 font-medium';
    default:
      return 'text-slate-400';
  }
}

export function evidenceTextClass(strength: EvidenceStrength | undefined): string {
  switch (strength) {
    case 'Strong':
      return 'text-emerald-700 font-medium';
    case 'Moderate':
      return 'text-blue-700 font-medium';
    case 'Insufficient':
    default:
      return 'text-amber-700 font-medium';
  }
}

export function priorityTextClass(priority: PriorityLevel | string): string {
  if (priority.startsWith('P0')) return 'text-red-700 font-semibold';
  if (priority.startsWith('P1')) return 'text-blue-700 font-semibold';
  if (priority.startsWith('P2')) return 'text-slate-700 font-medium';
  return 'text-slate-500 font-medium';
}

export function actionStatusTextClass(status: ActionStatus): string {
  switch (status) {
    case 'Completed':
      return 'text-emerald-700 font-medium';
    case 'In progress':
      return 'text-blue-700 font-medium';
    case 'Not started':
    default:
      return 'text-slate-600 font-medium';
  }
}

export function formatShortDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const SAMPLE_UPLOAD_CSV = `feedback_id,customer_text,source,feedback_date,customer_segment,customer_id,product_area
FB-3001,"Onboarding failed when we tried assigning custom security roles to our finance analysts.",Support Ticket,2026-11-15,Enterprise,CUST-901,Onboarding
FB-3002,"Loading the 90-day trend view took 19 seconds and timed out before our QBR call.",Intercom Chat,2026-11-15,Enterprise,CUST-902,Performance
FB-3003,"We were charged for 4 read-only executives without any quota warning email. Reviewing alternatives next month.",Support Ticket,2026-11-16,Mid-Market,CUST-903,Billing & Pricing
FB-3004,"Love how every theme links directly back to verbatim quotes—saved our PM team hours this week.",G2 Review,2026-11-16,Startup,CUST-904,Analytics & Reports
FB-3005,"The search bar didn't match 'invoice' when searching for billing tickets.",In-App Survey,2026-11-16,SMB,CUST-905,Search & Filtering
FB-3001,"Onboarding failed when we tried assigning custom security roles to our finance analysts.",Support Ticket,2026-11-15,Enterprise,CUST-901,Onboarding
FB-3006,"",In-App Survey,2026-11-16,SMB,CUST-906,General
FB-3007,"Exported CSV truncated rows silently after 10,000 lines.",Support Ticket,not-a-valid-date,Enterprise,CUST-907,Integrations & Exports`;
