/** Lightweight custom-model facade. TensorFlow loads only on Train/Load. */
import type { EvaluationMetrics, GestureSample, TrainingConfig, TrainingLog } from '../contexts/AppContext';
import type { CustomModel } from './modelEngine';
import { splitTrainingSamples } from './trainingSplit';

export const FEATURE_DIM = 63;
export interface ValidationInfo {
  sampleCount: number; trainingSampleCount: number; seed: number; datasetRevision: number;
  support: Record<string, number>;
}
export interface ModelSnapshot {
  status: 'idle' | 'running' | 'loading' | 'saving' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
  busy: boolean; ready: boolean; logs: TrainingLog[]; progress: number; error: string | null;
  metrics: EvaluationMetrics | null; validation: ValidationInfo | null;
}
let snapshot: ModelSnapshot = { status: 'idle', busy: false, ready: false, logs: [], progress: 0, error: null, metrics: null, validation: null };
const listeners = new Set<() => void>();
export const getModelSnapshot = () => snapshot;
export const subscribeModel = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let engine: typeof import('./modelEngine') | null = null;
let enginePromise: Promise<typeof import('./modelEngine')> | null = null;
let current: CustomModel | null = null;
let generation = 0;
let active: AbortController | null = null;
const retired = new Set<CustomModel>();
function update(partial: Partial<ModelSnapshot>) {
  snapshot = { ...snapshot, ...partial, ready: current !== null };
  listeners.forEach(listener => listener());
}
function getEngine() {
  if (!enginePromise) enginePromise = import('./modelEngine').then(value => engine = value).catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}
function releaseRetired() { for (const model of retired) engine?.dispose(model); retired.clear(); }
function replace(candidate: CustomModel | null) {
  if (current) {
    if (snapshot.status === 'saving') retired.add(current);
    else engine?.dispose(current);
  }
  current = candidate;
}
function abortError() { return new DOMException('Model operation cancelled', 'AbortError'); }

export async function startTraining(samples: GestureSample[], config: TrainingConfig, datasetRevision: number): Promise<void> {
  if (snapshot.busy) throw new Error('A model operation is already running');
  if (!Number.isInteger(config.epochs) || config.epochs < 1 || !Number.isInteger(config.batchSize) || config.batchSize < 1 ||
      !Number.isFinite(config.learningRate) || config.learningRate <= 0) throw new Error('Invalid training configuration');
  const capturedConfig = { ...config };
  const partition = splitTrainingSamples(samples.map(s => ({ ...s, landmarks: [...s.landmarks] })), capturedConfig.validationSplit);
  const run = ++generation;
  const controller = new AbortController();
  active = controller;
  update({ busy: true, status: 'running', logs: [], progress: 0, error: null });
  let pendingCandidate: CustomModel | null = null;
  try {
    const implementation = await getEngine();
    controller.signal.throwIfAborted();
    const result = await implementation.trainCandidate(partition, capturedConfig, controller.signal, log => {
      if (run === generation && !controller.signal.aborted) update({ logs: [...snapshot.logs, log], progress: Math.round(log.epoch / capturedConfig.epochs * 100) });
    });
    pendingCandidate = result.candidate;
    if (run !== generation || controller.signal.aborted) throw abortError();
    replace(pendingCandidate);
    pendingCandidate = null;
    const support: Record<string, number> = Object.create(null);
    partition.labelNames.forEach(label => support[label] = partition.validation.filter(s => s.label === label).length);
    update({ status: 'completed', progress: 100, metrics: result.metrics,
      validation: { sampleCount: partition.validation.length, trainingSampleCount: partition.train.length,
        seed: partition.seed, datasetRevision, support } });
  } catch (error) {
    if (controller.signal.aborted || run !== generation) {
      if (snapshot.status === 'cancelling') update({ status: 'cancelled' });
      throw abortError();
    }
    update({ status: 'failed', error: error instanceof Error ? error.message : 'Training failed' });
    throw error;
  } finally {
    if (pendingCandidate) engine?.dispose(pendingCandidate);
    if (active === controller) { active = null; update({ busy: false, ...(snapshot.status === 'cancelling' ? { status: 'cancelled' as const } : {}) }); }
    releaseRetired();
  }
}

export function cancelTraining(): void {
  if (active && snapshot.status === 'running') {
    ++generation;
    active.abort();
    update({ status: 'cancelling' });
  }
}

export async function loadModel(): Promise<boolean> {
  if (snapshot.busy) return false;
  const run = ++generation;
  const controller = new AbortController();
  active = controller;
  update({ status: 'loading', busy: true, error: null });
  let candidate: CustomModel | null = null;
  try {
    const implementation = await getEngine();
    if (run !== generation) return false;
    candidate = await implementation.load();
    if (run !== generation) return false;
    replace(candidate);
    candidate = null;
    update({ status: 'idle', metrics: null, validation: null, logs: [], progress: 0 });
    return true;
  } catch (error) {
    if (run === generation) update({ status: 'failed', error: error instanceof Error ? error.message : 'No compatible saved model found' });
    return false;
  } finally {
    if (candidate) engine?.dispose(candidate);
    if (active === controller) { active = null; update({ busy: false, ...(snapshot.status === 'cancelling' ? { status: 'cancelled' as const } : {}) }); }
  }
}

export async function saveModel(): Promise<void> {
  if (snapshot.busy) throw new Error('Wait for the current model operation');
  if (!current || !engine) throw new Error('No model to save');
  const model = current;
  const run = generation;
  update({ busy: true, status: 'saving' });
  try { await engine.save(model); }
  finally { update({ busy: false, status: run === generation ? 'idle' : 'cancelled' }); releaseRetired(); }
}

export function predict(features: number[]): { label: string; confidence: number; allScores: {label: string; score: number}[] } | null {
  return current && engine ? engine.predict(current, features) : null;
}
export function isModelReady(): boolean { return current !== null; }
export function getModelState() { return { model: current?.model ?? null, labels: current?.labels ?? [] }; }
/** Dataset mutations synchronously revoke permission for pending operations to publish. */
export function disposeModel(): void {
  ++generation;
  active?.abort();
  replace(null);
  update({ status: snapshot.busy ? 'cancelling' : 'idle', metrics: null, validation: null, logs: [], progress: 0, error: null });
}
