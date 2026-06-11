/**
 * TrainPage.tsx — Model Training Dashboard
 * Features:
 * - Configurable hyperparameters (epochs, batch size, learning rate, val split)
 * - Live training progress with loss/accuracy charts
 * - Train/validation split selector
 * - Model save/load
 * - Post-training evaluation trigger
 */

import { useState, useCallback, useRef } from 'react';
import { Brain, Play, Save, Upload, AlertCircle, CheckCircle, Settings2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useApp } from '../contexts/AppContext';
import { prepareTensors } from '../dataset/datasetUtils';
import { trainModel, saveModel, loadModel, computeMetrics } from '../ml/model';
import type { TrainingLog } from '../contexts/AppContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function TrainPage() {
  const {
    dataset, trainingConfig, setTrainingConfig,
    trainingLogs, setTrainingLogs,
    isModelTrained, setIsModelTrained,
    setEvaluationMetrics,
  } = useApp();

  const [isTraining, setIsTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [latestLog, setLatestLog] = useState<TrainingLog | null>(null);
  const abortRef = useRef(false);

  const canTrain = dataset.samples.length >= 10 && dataset.labels.length >= 2;

  const handleTrain = useCallback(async () => {
    if (!canTrain) {
      toast.error('Need at least 10 samples across 2+ gesture classes');
      return;
    }

    setIsTraining(true);
    setTrainingLogs([]);
    setProgress(0);
    setCurrentEpoch(0);
    abortRef.current = false;

    try {
      const { features, labels, labelIndices } = prepareTensors(dataset.samples, dataset.labels);
      const logs: TrainingLog[] = [];

      const model = await trainModel(
        features,
        labels,
        trainingConfig,
        dataset.labels,
        (log) => {
          logs.push(log);
          setTrainingLogs([...logs]);
          setLatestLog(log);
          setCurrentEpoch(log.epoch);
        },
        (pct) => setProgress(pct)
      );

      // Compute evaluation metrics on full dataset
      const metrics = computeMetrics(features, labelIndices, dataset.labels);
      setEvaluationMetrics(metrics);
      setIsModelTrained(true);

      toast.success(`Training complete! Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`);
    } catch (err: unknown) {
      toast.error(`Training failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsTraining(false);
    }
  }, [canTrain, dataset, trainingConfig, setTrainingLogs, setEvaluationMetrics, setIsModelTrained]);

  const handleSave = async () => {
    try {
      await saveModel();
      toast.success('Model saved to browser storage');
    } catch {
      toast.error('Failed to save model');
    }
  };

  const handleLoad = async () => {
    try {
      const ok = await loadModel();
      if (ok) {
        setIsModelTrained(true);
        toast.success('Model loaded from browser storage');
      } else {
        toast.error('No saved model found');
      }
    } catch {
      toast.error('Failed to load model');
    }
  };

  const lastLog = trainingLogs[trainingLogs.length - 1];

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
          Training Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure and train the MLP gesture classifier in your browser using TensorFlow.js.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* ── Left: Config + Controls ──────────────────────────────── */}
        <div className="space-y-4">
          {/* Dataset status */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Space Grotesk' }}>
              Dataset Status
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Samples</span>
                <span className="text-xs font-mono text-foreground">{dataset.samples.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Classes</span>
                <span className="text-xs font-mono text-foreground">{dataset.labels.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Avg per class</span>
                <span className="text-xs font-mono text-foreground">
                  {dataset.labels.length > 0
                    ? Math.round(dataset.samples.length / dataset.labels.length)
                    : 0}
                </span>
              </div>
            </div>
            {!canTrain && (
              <div className="mt-3 flex items-start gap-2 p-2 rounded-lg bg-warning/10 border border-warning/20">
                <AlertCircle className="w-3.5 h-3.5 text-warning mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-warning">
                  Need at least 10 samples and 2 gesture classes to train.
                </p>
              </div>
            )}
          </div>

          {/* Hyperparameters */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Settings2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
                Hyperparameters
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Epochs: <span className="text-foreground font-mono">{trainingConfig.epochs}</span>
                </label>
                <input
                  type="range" min={5} max={200} step={5}
                  value={trainingConfig.epochs}
                  onChange={e => setTrainingConfig({ epochs: Number(e.target.value) })}
                  disabled={isTraining}
                  className="w-full accent-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Batch Size: <span className="text-foreground font-mono">{trainingConfig.batchSize}</span>
                </label>
                <input
                  type="range" min={8} max={128} step={8}
                  value={trainingConfig.batchSize}
                  onChange={e => setTrainingConfig({ batchSize: Number(e.target.value) })}
                  disabled={isTraining}
                  className="w-full accent-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Learning Rate: <span className="text-foreground font-mono">{trainingConfig.learningRate}</span>
                </label>
                <select
                  value={trainingConfig.learningRate}
                  onChange={e => setTrainingConfig({ learningRate: Number(e.target.value) })}
                  disabled={isTraining}
                  className="w-full px-2 py-1.5 rounded-lg bg-muted border border-border text-xs text-foreground focus:outline-none focus:border-primary/50"
                >
                  <option value={0.0001}>0.0001 (Very Slow)</option>
                  <option value={0.001}>0.001 (Default)</option>
                  <option value={0.005}>0.005 (Fast)</option>
                  <option value={0.01}>0.01 (Very Fast)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Validation Split: <span className="text-foreground font-mono">{Math.round(trainingConfig.validationSplit * 100)}%</span>
                </label>
                <input
                  type="range" min={0.1} max={0.4} step={0.05}
                  value={trainingConfig.validationSplit}
                  onChange={e => setTrainingConfig({ validationSplit: Number(e.target.value) })}
                  disabled={isTraining}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>Train: {Math.round((1 - trainingConfig.validationSplit) * 100)}%</span>
                  <span>Val: {Math.round(trainingConfig.validationSplit * 100)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={handleTrain}
              disabled={!canTrain || isTraining}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all",
                canTrain && !isTraining
                  ? "bg-primary text-primary-foreground hover:opacity-90 glow-cyan"
                  : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
              )}
            >
              {isTraining ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Training... ({progress}%)
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Training
                </>
              )}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleSave}
                disabled={!isModelTrained}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-foreground border border-border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-3.5 h-3.5" />
                Save Model
              </button>
              <button
                onClick={handleLoad}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-foreground border border-border text-xs font-medium hover:bg-accent transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Load Model
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Charts + Metrics ──────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          {/* Progress bar */}
          {isTraining && (
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted-foreground">
                  Epoch {currentEpoch} / {trainingConfig.epochs}
                </span>
                <span className="text-xs font-mono text-primary">{progress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {latestLog && (
                <div className="grid grid-cols-4 gap-3 mt-3">
                  {[
                    { label: 'Loss', value: latestLog.loss },
                    { label: 'Accuracy', value: `${(latestLog.accuracy * 100).toFixed(1)}%` },
                    { label: 'Val Loss', value: latestLog.valLoss },
                    { label: 'Val Acc', value: `${(latestLog.valAccuracy * 100).toFixed(1)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted/50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className="text-sm font-mono font-bold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Loss chart */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Space Grotesk' }}>
              Training Loss
            </h3>
            {trainingLogs.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trainingLogs}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 6%)" />
                  <XAxis
                    dataKey="epoch"
                    tick={{ fontSize: 10, fill: 'oklch(0.58 0.012 255)' }}
                    label={{ value: 'Epoch', position: 'insideBottom', offset: -2, fontSize: 10, fill: 'oklch(0.58 0.012 255)' }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'oklch(0.58 0.012 255)' }} />
                  <Tooltip
                    contentStyle={{ background: 'oklch(0.155 0.014 255)', border: '1px solid oklch(1 0 0 / 8%)', borderRadius: '8px', fontSize: 11 }}
                    labelStyle={{ color: 'oklch(0.92 0.008 220)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="loss" stroke="oklch(0.85 0.18 195)" strokeWidth={2} dot={false} name="Train Loss" />
                  <Line type="monotone" dataKey="valLoss" stroke="oklch(0.65 0.22 25)" strokeWidth={2} dot={false} name="Val Loss" strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
                Training data will appear here
              </div>
            )}
          </div>

          {/* Accuracy chart */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Space Grotesk' }}>
              Training Accuracy
            </h3>
            {trainingLogs.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trainingLogs}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 6%)" />
                  <XAxis
                    dataKey="epoch"
                    tick={{ fontSize: 10, fill: 'oklch(0.58 0.012 255)' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'oklch(0.58 0.012 255)' }}
                    domain={[0, 1]}
                    tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{ background: 'oklch(0.155 0.014 255)', border: '1px solid oklch(1 0 0 / 8%)', borderRadius: '8px', fontSize: 11 }}
                    labelStyle={{ color: 'oklch(0.92 0.008 220)' }}
                    formatter={(v: number): string => `${(v * 100).toFixed(1)}%`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="accuracy" stroke="oklch(0.72 0.17 162)" strokeWidth={2} dot={false} name="Train Acc" />
                  <Line type="monotone" dataKey="valAccuracy" stroke="oklch(0.78 0.17 65)" strokeWidth={2} dot={false} name="Val Acc" strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
                Training data will appear here
              </div>
            )}
          </div>

          {/* Final metrics summary */}
          {isModelTrained && lastLog && (
            <div className="bg-card border border-primary/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-4 h-4 text-success" />
                <h3 className="text-sm font-semibold text-success" style={{ fontFamily: 'Space Grotesk' }}>
                  Training Complete
                </h3>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Final Loss', value: lastLog.loss },
                  { label: 'Train Accuracy', value: `${(lastLog.accuracy * 100).toFixed(1)}%` },
                  { label: 'Val Loss', value: lastLog.valLoss },
                  { label: 'Val Accuracy', value: `${(lastLog.valAccuracy * 100).toFixed(1)}%` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-lg font-mono font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                View detailed evaluation metrics in the Evaluate tab.
              </p>
            </div>
          )}

          {/* Architecture info */}
          <div className="bg-muted/30 border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Model Architecture
            </h3>
            <div className="font-mono text-xs text-muted-foreground space-y-1">
              <p>Input: Dense(256) → 156 features [R63|L63|Face30]</p>
              <p>Hidden 1: Dense(256, ReLU) + Dropout(0.3)</p>
              <p>Hidden 2: Dense(128, ReLU) + Dropout(0.2)</p>
              <p>Output: Dense({dataset.labels.length || 'N'}, Softmax)</p>
              <p className="text-primary mt-2">Optimizer: Adam · Loss: Categorical Cross-Entropy · Class Weights ON</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
