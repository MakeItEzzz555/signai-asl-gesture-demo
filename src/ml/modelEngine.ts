/** Heavy TensorFlow implementation; imported only for custom model operations. */
import * as tf from '@tensorflow/tfjs';
import type { TrainingConfig, TrainingLog, EvaluationMetrics } from '../contexts/AppContext';
import { FEATURE_DIM_HAND, toHandOnlyFeatures } from '../utils/landmarks';
import { encodeTrainingSamples, type TrainingPartition } from './trainingSplit';

const FEATURE_DIM = FEATURE_DIM_HAND;
export interface CustomModel { model: tf.LayersModel; labels: string[] }

export function buildModel(numClasses: number, learningRate: number): tf.LayersModel {
  const model = tf.sequential({
    name: 'sign-language-mlp',
    layers: [
      // Input layer — accepts hand-only feature vectors
      tf.layers.dense({
        inputShape: [FEATURE_DIM],
        units: 256,
        activation: 'relu',
        name: 'hidden_1',
        kernelInitializer: 'glorotUniform',
      }),
      // Dropout to prevent overfitting
      tf.layers.dropout({ rate: 0.3, name: 'dropout_1' }),
      // Second hidden layer
      tf.layers.dense({
        units: 128,
        activation: 'relu',
        name: 'hidden_2',
        kernelInitializer: 'glorotUniform',
      }),
      tf.layers.dropout({ rate: 0.2, name: 'dropout_2' }),
      // Output layer — softmax for multi-class probability distribution
      tf.layers.dense({
        units: numClasses,
        activation: 'softmax',
        name: 'output',
      }),
    ],
  });

  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  return model;
}


export function dispose(candidate: CustomModel): void {
  candidate.model.dispose();
  candidate.model.optimizer?.dispose();
}

function predictions(candidate: CustomModel, features: number[][]): number[][] {
  return tf.tidy(() => {
    const input = tf.tensor2d(features);
    return (candidate.model.predict(input) as tf.Tensor).arraySync() as number[][];
  });
}

export function predict(candidate: CustomModel, features: number[]) {
  const scores = predictions(candidate, [toHandOnlyFeatures(features)])[0];
  const allScores = candidate.labels.map((label, i) => ({ label, score: Math.round(scores[i] * 1000) / 10 }))
    .sort((a, b) => b.score - a.score);
  return { label: allScores[0].label, confidence: allScores[0].score, allScores };
}

export function computeMetrics(candidate: CustomModel, features: number[][], trueLabels: number[]): EvaluationMetrics {
  if (!features.length || trueLabels.length !== features.length) throw new Error('Validation samples are required');
  const labels = candidate.labels;
  const matrix = labels.map(() => labels.map(() => 0));
  const scores = predictions(candidate, features);
  for (let i = 0; i < scores.length; i++) {
    const index = scores[i].indexOf(Math.max(...scores[i]));
    if (!matrix[trueLabels[i]] || index < 0 || index >= labels.length) throw new Error('Invalid model output or validation label');
    matrix[trueLabels[i]][index]++;
  }
  const precision: Record<string, number> = Object.create(null);
  const recall: Record<string, number> = Object.create(null);
  const f1Score: Record<string, number> = Object.create(null);
  const perClassAccuracy: Record<string, number> = Object.create(null);
  let correct = 0;
  labels.forEach((label, c) => {
    const tp = matrix[c][c];
    correct += tp;
    const fp = matrix.reduce((sum, row, i) => sum + (i === c ? 0 : row[c]), 0);
    const fn = matrix[c].reduce((sum, n, i) => sum + (i === c ? 0 : n), 0);
    precision[label] = tp + fp ? tp / (tp + fp) : 0;
    recall[label] = tp + fn ? tp / (tp + fn) : 0;
    const denominator = precision[label] + recall[label];
    f1Score[label] = denominator ? 2 * precision[label] * recall[label] / denominator : 0;
    perClassAccuracy[label] = (features.length - fp - fn) / features.length;
  });
  return { accuracy: correct / features.length, precision, recall, f1Score, perClassAccuracy, confusionMatrix: matrix, labels };
}

export async function trainCandidate(partition: TrainingPartition, config: TrainingConfig, signal: AbortSignal,
  onEpoch: (log: TrainingLog) => void): Promise<{ candidate: CustomModel; metrics: EvaluationMetrics }> {
  signal.throwIfAborted();
  const candidate = { model: buildModel(partition.labelNames.length, config.learningRate), labels: partition.labelNames };
  const tensors: tf.Tensor[] = [];
  let accepted = false;
  const abort = () => { candidate.model.stopTraining = true; };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const training = encodeTrainingSamples(partition.train, partition.labelNames, true);
    const validation = encodeTrainingSamples(partition.validation, partition.labelNames, false);
    const tensor = (rows: number[][]) => { const t = tf.tensor2d(rows); tensors.push(t); return t; };
    const xs = tensor(training.features), ys = tensor(training.labels);
    const vx = tensor(validation.features), vy = tensor(validation.labels);
    const counts = partition.labelNames.map((_, i) => training.labelIndices.filter(index => index === i).length);
    const classWeight = Object.fromEntries(counts.map((count, i) => [i, training.features.length / (counts.length * count)]));
    await candidate.model.fit(xs, ys, {
      epochs: config.epochs, batchSize: config.batchSize, shuffle: true, validationData: [vx, vy], classWeight,
      callbacks: {
        onBatchEnd: () => { if (signal.aborted) candidate.model.stopTraining = true; },
        onEpochEnd: (epoch, logs) => {
          if (signal.aborted) return;
          onEpoch({ epoch: epoch + 1, loss: logs?.loss ?? 0, accuracy: logs?.acc ?? logs?.accuracy ?? 0,
            valLoss: logs?.val_loss ?? 0, valAccuracy: logs?.val_acc ?? logs?.val_accuracy ?? 0 });
        },
      },
    });
    signal.throwIfAborted();
    const metrics = computeMetrics(candidate, validation.features, validation.labelIndices);
    accepted = true;
    return { candidate, metrics };
  } finally {
    signal.removeEventListener('abort', abort);
    tensors.forEach(t => t.dispose());
    if (!accepted) dispose(candidate);
  }
}

export async function save(candidate: CustomModel): Promise<void> {
  // Model and class labels share one TFJS artifact transaction.
  await candidate.model.setUserDefinedMetadata({ signaiLabels: candidate.labels, featureDim: FEATURE_DIM });
  await candidate.model.save('indexeddb://signai-custom-model-v1');
}

export async function load(): Promise<CustomModel> {
  let model: tf.LayersModel;
  let modern = true;
  try { model = await tf.loadLayersModel('indexeddb://signai-custom-model-v1'); }
  catch { modern = false; model = await tf.loadLayersModel('localstorage://sign-language-model'); }
  try {
    const metadata = modern ? await model.getUserDefinedMetadata() : null;
    const labels: unknown = modern ? (metadata as Record<string, unknown> | null)?.signaiLabels : JSON.parse(localStorage.getItem('sign-language-labels') ?? 'null');
    if (model.inputs.length !== 1 || model.outputs.length !== 1 || model.inputs[0].shape.at(-1) !== FEATURE_DIM ||
      !Array.isArray(labels) || labels.length < 2 || labels.some(l => typeof l !== 'string' || !l.trim()) ||
      new Set(labels).size !== labels.length || model.outputs[0].shape.at(-1) !== labels.length) {
      throw new Error('Saved model has incompatible input dimensions or class labels');
    }
    return { model, labels: labels as string[] };
  } catch (error) {
    model.dispose();
    model.optimizer?.dispose();
    throw error;
  }
}
