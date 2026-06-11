/**
 * EvaluatePage.tsx — Model Evaluation Dashboard
 * Displays:
 * - Overall accuracy, precision, recall, F1-score
 * - Confusion matrix heatmap
 * - Per-class accuracy bars
 * - Per-class precision/recall/F1 table
 */

import { BarChart2, AlertCircle, TrendingUp, Target, Layers } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useApp } from '../contexts/AppContext';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

function MetricCard({ label, value, color, description }: {
  label: string; value: string; color: string; description: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide mb-1">{label}</p>
      <p className={cn("text-3xl font-bold font-mono", color)}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{description}</p>
    </div>
  );
}

function ConfusionMatrix({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  const max = Math.max(...matrix.flat());
  return (
    <div className="overflow-auto">
      <div className="min-w-max">
        {/* Header row */}
        <div className="flex">
          <div className="w-20 h-8" />
          {labels.map(l => (
            <div key={l} className="w-16 h-8 flex items-center justify-center">
              <span className="text-[9px] font-mono text-muted-foreground truncate max-w-[56px] text-center leading-tight">
                {l}
              </span>
            </div>
          ))}
        </div>
        {/* Matrix rows */}
        {matrix.map((row, i) => (
          <div key={labels[i]} className="flex items-center">
            <div className="w-20 h-10 flex items-center justify-end pr-2">
              <span className="text-[9px] font-mono text-muted-foreground truncate">{labels[i]}</span>
            </div>
            {row.map((val, j) => {
              const intensity = max > 0 ? val / max : 0;
              const isDiag = i === j;
              return (
                <div
                  key={`${labels[i]}-${labels[j]}`}
                  className="w-16 h-10 flex items-center justify-center border border-border/30"
                  style={{
                    backgroundColor: isDiag
                      ? `oklch(0.72 0.17 162 / ${intensity * 0.8 + 0.1})`
                      : val > 0
                        ? `oklch(0.65 0.22 25 / ${intensity * 0.6 + 0.05})`
                        : 'transparent',
                  }}
                >
                  <span className={cn(
                    "text-xs font-mono font-bold",
                    val > 0 ? "text-foreground" : "text-muted-foreground/30"
                  )}>
                    {val}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {/* Axis labels */}
        <div className="flex mt-2">
          <div className="w-20" />
          <div className="flex-1 text-center">
            <span className="text-[10px] text-muted-foreground">Predicted →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EvaluatePage() {
  const { evaluationMetrics, isModelTrained } = useApp();

  if (!isModelTrained || !evaluationMetrics) {
    return (
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
            Evaluation Metrics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Train a model first to see evaluation metrics.
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2" style={{ fontFamily: 'Space Grotesk' }}>
            No Model Trained Yet
          </h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            Record gesture samples in the Dataset Manager, then train a model in the Training Dashboard to see evaluation metrics here.
          </p>
          <Link href="/train">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity">
              <BarChart2 className="w-4 h-4" />
              Go to Training
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const { accuracy, precision, recall, f1Score, confusionMatrix, perClassAccuracy, labels } = evaluationMetrics;

  // Compute macro averages
  const macroPrec = Object.values(precision).reduce((a, b) => a + b, 0) / labels.length;
  const macroRecall = Object.values(recall).reduce((a, b) => a + b, 0) / labels.length;
  const macroF1 = Object.values(f1Score).reduce((a, b) => a + b, 0) / labels.length;

  // Per-class chart data
  const classChartData = labels.map(label => ({
    name: label,
    precision: Number((precision[label] * 100).toFixed(1)),
    recall: Number((recall[label] * 100).toFixed(1)),
    f1: Number((f1Score[label] * 100).toFixed(1)),
    accuracy: Number((perClassAccuracy[label] * 100).toFixed(1)),
  }));

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
          Evaluation Metrics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Comprehensive performance analysis of the trained gesture classifier.
        </p>
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          label="Accuracy"
          value={`${(accuracy * 100).toFixed(1)}%`}
          color="text-primary"
          description="Overall correct predictions"
        />
        <MetricCard
          label="Macro Precision"
          value={`${(macroPrec * 100).toFixed(1)}%`}
          color="text-success"
          description="Avg TP / (TP + FP)"
        />
        <MetricCard
          label="Macro Recall"
          value={`${(macroRecall * 100).toFixed(1)}%`}
          color="text-warning"
          description="Avg TP / (TP + FN)"
        />
        <MetricCard
          label="Macro F1-Score"
          value={`${(macroF1 * 100).toFixed(1)}%`}
          color="text-destructive"
          description="Harmonic mean P + R"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* ── Confusion Matrix ──────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
              Confusion Matrix
            </h3>
          </div>
          <div className="flex">
            {/* Actual label */}
            <div className="flex items-center justify-center w-6 mr-1">
              <span className="text-[10px] text-muted-foreground -rotate-90 whitespace-nowrap">
                Actual ↓
              </span>
            </div>
            <ConfusionMatrix matrix={confusionMatrix} labels={labels} />
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-success/60" />
              <span>Correct (diagonal)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-destructive/40" />
              <span>Misclassified</span>
            </div>
          </div>
        </div>

        {/* ── Per-class Metrics Table ───────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
              Per-Class Metrics
            </h3>
          </div>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 font-mono text-muted-foreground font-medium">Gesture</th>
                  <th className="text-right py-2 px-2 font-mono text-muted-foreground font-medium">Prec</th>
                  <th className="text-right py-2 px-2 font-mono text-muted-foreground font-medium">Recall</th>
                  <th className="text-right py-2 px-2 font-mono text-muted-foreground font-medium">F1</th>
                  <th className="text-right py-2 pl-2 font-mono text-muted-foreground font-medium">Acc</th>
                </tr>
              </thead>
              <tbody>
                {labels.map(label => {
                  const p = precision[label];
                  const r = recall[label];
                  const f = f1Score[label];
                  const a = perClassAccuracy[label];
                  const isGood = f >= 0.8;
                  return (
                    <tr key={label} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-3 font-medium text-foreground">{label}</td>
                      <td className={cn("text-right py-2 px-2 font-mono", p >= 0.8 ? "text-success" : p >= 0.6 ? "text-warning" : "text-destructive")}>
                        {(p * 100).toFixed(0)}%
                      </td>
                      <td className={cn("text-right py-2 px-2 font-mono", r >= 0.8 ? "text-success" : r >= 0.6 ? "text-warning" : "text-destructive")}>
                        {(r * 100).toFixed(0)}%
                      </td>
                      <td className={cn("text-right py-2 px-2 font-mono font-bold", isGood ? "text-success" : "text-warning")}>
                        {(f * 100).toFixed(0)}%
                      </td>
                      <td className="text-right py-2 pl-2 font-mono text-muted-foreground">
                        {(a * 100).toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td className="py-2 pr-3 font-semibold text-foreground">Macro Avg</td>
                  <td className="text-right py-2 px-2 font-mono font-bold text-primary">{(macroPrec * 100).toFixed(0)}%</td>
                  <td className="text-right py-2 px-2 font-mono font-bold text-primary">{(macroRecall * 100).toFixed(0)}%</td>
                  <td className="text-right py-2 px-2 font-mono font-bold text-primary">{(macroF1 * 100).toFixed(0)}%</td>
                  <td className="text-right py-2 pl-2 font-mono font-bold text-primary">{(accuracy * 100).toFixed(0)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* ── Per-class Bar Chart ──────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
            Per-Class F1-Score
          </h3>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={classChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 6%)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'oklch(0.58 0.012 255)' }} />
            <YAxis
              tick={{ fontSize: 10, fill: 'oklch(0.58 0.012 255)' }}
              domain={[0, 100]}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip
              contentStyle={{ background: 'oklch(0.155 0.014 255)', border: '1px solid oklch(1 0 0 / 8%)', borderRadius: '8px', fontSize: 11 }}
              formatter={(v: number) => `${v}%`}
            />
            <Bar dataKey="f1" name="F1-Score" radius={[4, 4, 0, 0]}>
              {classChartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.f1 >= 80
                    ? 'oklch(0.72 0.17 162)'
                    : entry.f1 >= 60
                      ? 'oklch(0.78 0.17 65)'
                      : 'oklch(0.65 0.22 25)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
