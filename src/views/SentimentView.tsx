import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { apiRequest, sentimentTextClass, severityTextClass } from '../lib/api';
import type { DashboardMetrics, FeedbackRecord, SentimentType, SeverityLevel } from '../../shared/types';

interface SentimentViewProps {
  workspaceId: string;
  metrics: DashboardMetrics | null;
  onDataChanged: () => void;
}

export const SentimentView: React.FC<SentimentViewProps> = ({
  workspaceId,
  metrics,
  onDataChanged,
}) => {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [matrixFilter, setMatrixFilter] = useState<{ sentiment: SentimentType; severity: SeverityLevel } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ records?: FeedbackRecord[] }>(`/api/workspaces/${workspaceId}/feedback`);
      setRecords(Array.isArray(res?.records) ? res.records : []);
    } catch (err) {
      setRecords([]);
      setError(err instanceof Error ? err.message : 'Unable to load sentiment records.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function overrideSentiment(recordId: string, nextSentiment: SentimentType) {
    setUpdatingId(recordId);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/feedback/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ sentiment: nextSentiment }),
      });
      await loadRecords();
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sentiment.');
    } finally {
      setUpdatingId(null);
    }
  }

  const ambiguousRecords = records.filter((r) => r.sentiment === 'Mixed' || r.sentiment === 'Uncertain');
  const matrixFilteredRecords = matrixFilter
    ? records.filter((r) => r.sentiment === matrixFilter.sentiment && r.severity === matrixFilter.severity)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Sentiment Analysis</h1>
        <p className="text-sm text-slate-600 mt-1">
          Sentiment measures customer tone (Positive, Negative, Neutral, Mixed, Uncertain) independently of business severity. Ambiguous records surface explicit explanations for PM review.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
          {error}
        </div>
      )}

      {metrics && (
        <>
          {/* 5-Category Clean Distribution Strip */}
          <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            {metrics.sentiment_distribution.map((row) => (
              <div key={row.sentiment} className="p-4">
                <div className={`text-xs ${sentimentTextClass(row.sentiment)}`}>{row.sentiment}</div>
                <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {row.count}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                  {row.percentage}% of total
                </div>
              </div>
            ))}
          </div>

          {/* Sentiment vs. Severity Separation Matrix + Product Area Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-900">Sentiment vs. Severity Separation Matrix</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Proves negative tone is not automatically high severity, and calm neutral feedback can still signal high severity. Click any cell to inspect records.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Sentiment</th>
                      <th className="py-2 px-3 text-right font-semibold">Low Severity</th>
                      <th className="py-2 px-3 text-right font-semibold">Medium Severity</th>
                      <th className="py-2 pl-3 text-right font-semibold">High Severity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {metrics.sentiment_vs_severity.map((row) => (
                      <tr key={row.sentiment}>
                        <td className={`py-2.5 pr-3 ${sentimentTextClass(row.sentiment)}`}>{row.sentiment}</td>
                        {(['Low', 'Medium', 'High'] as SeverityLevel[]).map((sev) => {
                          const val = sev === 'Low' ? row.low : sev === 'Medium' ? row.medium : row.high;
                          const selected =
                            matrixFilter?.sentiment === row.sentiment && matrixFilter?.severity === sev;
                          return (
                            <td key={sev} className="py-1.5 px-2 text-right">
                              <button
                                type="button"
                                disabled={val === 0}
                                onClick={() =>
                                  setMatrixFilter(selected ? null : { sentiment: row.sentiment, severity: sev })
                                }
                                className={`w-full px-2.5 py-1.5 rounded font-mono tabular-nums transition-colors ${
                                  selected
                                    ? 'bg-blue-600 text-white font-semibold'
                                    : val > 0
                                    ? 'hover:bg-slate-100 text-slate-900 font-medium'
                                    : 'text-slate-300 cursor-default'
                                }`}
                              >
                                {val}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {matrixFilter && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-semibold text-slate-900">
                      Showing {matrixFilteredRecords.length} records: {matrixFilter.sentiment} Sentiment · {matrixFilter.severity} Severity
                    </span>
                    <button
                      type="button"
                      onClick={() => setMatrixFilter(null)}
                      className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Clear selection
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                    {matrixFilteredRecords.map((r) => (
                      <div key={r.id} className="p-3 text-xs">
                        <div className="text-slate-900">&ldquo;{r.customer_text}&rdquo;</div>
                        <div className="text-slate-500 mt-1">
                          <span className="font-mono">{r.feedback_id}</span> · {r.severity_reasoning || r.sentiment_reasoning}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-slate-900">Sentiment by Product Area</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Compare positive endorsement vs. negative friction across product modules
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={metrics.product_area_breakdown}
                    layout="vertical"
                    margin={{ top: 4, right: 12, left: 20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="product_area"
                      width={125}
                      tick={{ fontSize: 11, fill: '#334155' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        borderColor: '#E2E8F0',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="negative" name="Negative" fill="#DC2626" radius={[0, 3, 3, 0]} maxBarSize={14} />
                    <Bar dataKey="positive" name="Positive" fill="#16A34A" radius={[0, 3, 3, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Ambiguous / Mixed / Uncertain Review Queue */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Mixed & Uncertain Sentiment Review Queue ({ambiguousRecords.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ambiguous customer comments include AI explanations instead of forcing false certainty. Override manually if needed.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading sentiment records...</div>
        ) : ambiguousRecords.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No Mixed or Uncertain records currently require review in this workspace.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {ambiguousRecords.map((rec) => (
              <div key={rec.id} className="p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500">
                    <span className="font-mono font-medium text-slate-800">{rec.feedback_id}</span>
                    <span>·</span>
                    <span className={sentimentTextClass(rec.sentiment)}>{rec.sentiment}</span>
                    <span>·</span>
                    <span className={severityTextClass(rec.severity)}>{rec.severity || 'Unscored'} severity</span>
                    <span>·</span>
                    <span>{rec.customer_segment}</span>
                    <span>·</span>
                    <span>{rec.source}</span>
                  </div>
                  <p className="text-sm text-slate-900 leading-relaxed">&ldquo;{rec.customer_text}&rdquo;</p>
                  <p className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">Explanation: </span>
                    {rec.sentiment_reasoning || 'Contains nuanced or pending language requiring human judgment.'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {(['Positive', 'Neutral', 'Negative', 'Mixed', 'Uncertain'] as SentimentType[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={updatingId === rec.id}
                      onClick={() => overrideSentiment(rec.id, s)}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap ${
                        rec.sentiment === s
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
