/**
 * model.ts — TensorFlow.js MLP Classifier for Sign Language Gesture Recognition
 *
 * Architecture:
 *   Input: 156-feature vector [right hand(63) | left hand(63) | face(30)]
 *   Hidden Layer 1: Dense(256, ReLU) + Dropout(0.3)
 *   Hidden Layer 2: Dense(128, ReLU) + Dropout(0.2)
 *   Output: Dense(numClasses, Softmax)
 *
 * The extended 156-dim input enables:
 *   - Bimanual gesture recognition (both hands detected)
 *   - Face-interaction gestures (hand position relative to face landmarks)
 *
 * Training:
 *   Loss: Categorical Cross-Entropy
 *   Optimizer: Adam (configurable learning rate)
 *   Metrics: Accuracy
 *
 * Backward compatibility:
 *   Models saved with the legacy 63-dim input are detected on load and
 *   flagged as incompatible — user must retrain.
 */

import * as tf from '@tensorflow/tfjs';
import type { TrainingConfig, TrainingLog, EvaluationMetrics } from '../contexts/AppContext';

/** Current feature dimension: 156 = right(63) + left(63) + face(30) */
export const FEATURE_DIM = 156;
/** Legacy feature dimension (single hand only) */
const LEGACY_FEATURE_DIM = 63;
const FEATURE_VERSION_KEY = 'sign-language-feature-version';

// Singleton model instance
let currentModel: tf.LayersModel | null = null;
let currentLabels: string[] = [];

/**
 * Build the MLP classifier model.
 * @param numClasses Number of gesture classes
 * @param learningRate Adam optimizer learning rate
 */
export function buildModel(numClasses: number, learningRate: number): tf.LayersModel {
  const model = tf.sequential({
    name: 'sign-language-mlp',
    layers: [
      // Input layer — accepts 156-dim extended feature vectors
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

/**
 * Train the model on the provided dataset.
 * @param features 2D array of feature vectors [numSamples × 63]
 * @param labels Array of one-hot encoded label arrays [numSamples × numClasses]
 * @param config Training hyperparameters
 * @param labelNames Array of class names (for saving)
 * @param onEpochEnd Callback called after each epoch with metrics
 * @param onProgress Callback with progress percentage (0–100)
 */
export async function trainModel(
  features: number[][],
  labels: number[][],
  config: TrainingConfig,
  labelNames: string[],
  onEpochEnd: (log: TrainingLog) => void,
  onProgress?: (pct: number) => void
): Promise<tf.LayersModel> {
  // Dispose previous model to free GPU memory
  if (currentModel) {
    currentModel.dispose();
    currentModel = null;
  }

  const numClasses = labelNames.length;
  const model = buildModel(numClasses, config.learningRate);

  // Convert to tensors
  const xs = tf.tensor2d(features);
  const ys = tf.tensor2d(labels);

  // Inverse-frequency class weighting improves recall on underrepresented
  // gestures without changing label semantics.
  const classCounts = new Array(numClasses).fill(0);
  for (const row of labels) {
    const idx = row.findIndex(v => v === 1);
    if (idx >= 0) classCounts[idx] += 1;
  }
  const total = Math.max(1, labels.length);
  const classWeight: Record<number, number> = {};
  for (let i = 0; i < numClasses; i++) {
    const count = Math.max(1, classCounts[i]);
    classWeight[i] = total / (numClasses * count);
  }

  await model.fit(xs, ys, {
    epochs: config.epochs,
    batchSize: config.batchSize,
    validationSplit: config.validationSplit,
    shuffle: true,
    classWeight,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        const log: TrainingLog = {
          epoch: epoch + 1,
          loss: Number((logs?.loss ?? 0).toFixed(4)),
          accuracy: Number((logs?.acc ?? logs?.accuracy ?? 0).toFixed(4)),
          valLoss: Number((logs?.val_loss ?? 0).toFixed(4)),
          valAccuracy: Number((logs?.val_acc ?? logs?.val_accuracy ?? 0).toFixed(4)),
        };
        onEpochEnd(log);
        if (onProgress) {
          onProgress(Math.round(((epoch + 1) / config.epochs) * 100));
        }
      },
    },
  });

  // Clean up tensors
  xs.dispose();
  ys.dispose();

  currentModel = model;
  currentLabels = labelNames;

  return model;
}

/**
 * Run inference on a single 63-feature vector.
 * @param features 156-dim extended feature vector (or legacy 63-dim, which will be zero-padded)
 * @returns { label, confidence, allScores } or null if no model loaded
 */
export function predict(features: number[]): {
  label: string;
  confidence: number;
  allScores: { label: string; score: number }[];
} | null {
  if (!currentModel || currentLabels.length === 0) return null;

  // Ensure the feature vector is 156-dim (zero-pad legacy 63-dim inputs)
  let paddedFeatures = features;
  if (features.length === LEGACY_FEATURE_DIM) {
    paddedFeatures = [...features, ...new Array(FEATURE_DIM - LEGACY_FEATURE_DIM).fill(0)];
  }

  const input = tf.tensor2d([paddedFeatures]);
  const output = currentModel.predict(input) as tf.Tensor;
  const scores = Array.from(output.dataSync() as Float32Array);

  input.dispose();
  output.dispose();

  const maxIdx = scores.indexOf(Math.max(...scores));
  const allScores = currentLabels.map((label, i) => ({
    label,
    score: Number((scores[i] * 100).toFixed(1)),
  })).sort((a, b) => b.score - a.score);

  return {
    label: currentLabels[maxIdx],
    confidence: Number((scores[maxIdx] * 100).toFixed(1)),
    allScores,
  };
}

/**
 * Compute comprehensive evaluation metrics on a test set.
 *
 * Metrics computed:
 * - Overall accuracy: (correct predictions) / (total samples)
 * - Per-class precision: TP / (TP + FP) — how precise the predictions are
 * - Per-class recall: TP / (TP + FN) — how many true positives are caught
 * - Per-class F1-score: 2 × (precision × recall) / (precision + recall)
 * - Confusion matrix: [actual × predicted] count matrix
 * - Per-class accuracy: (TP + TN) / total
 *
 * @param features Test feature vectors
 * @param trueLabels True label indices
 * @param labelNames Array of class names
 */
export function computeMetrics(
  features: number[][],
  trueLabels: number[],
  labelNames: string[]
): EvaluationMetrics {
  if (!currentModel) throw new Error('No model loaded');

  const numClasses = labelNames.length;
  const n = features.length;

  // Get predictions
  const input = tf.tensor2d(features);
  const output = currentModel.predict(input) as tf.Tensor;
  const scores = output.arraySync() as number[][];
  input.dispose();
  output.dispose();

  const predictedLabels = scores.map(row => row.indexOf(Math.max(...row)));

  // Build confusion matrix [actual][predicted]
  const confusionMatrix: number[][] = Array.from({ length: numClasses }, () =>
    new Array(numClasses).fill(0)
  );
  for (let i = 0; i < n; i++) {
    confusionMatrix[trueLabels[i]][predictedLabels[i]]++;
  }

  // Compute per-class metrics
  const precision: Record<string, number> = {};
  const recall: Record<string, number> = {};
  const f1Score: Record<string, number> = {};
  const perClassAccuracy: Record<string, number> = {};

  for (let c = 0; c < numClasses; c++) {
    const label = labelNames[c];
    const tp = confusionMatrix[c][c];
    const fp = confusionMatrix.reduce((sum, row, r) => r !== c ? sum + row[c] : sum, 0);
    const fn = confusionMatrix[c].reduce((sum, v, j) => j !== c ? sum + v : sum, 0);
    const tn = n - tp - fp - fn;

    precision[label] = tp + fp > 0 ? Number((tp / (tp + fp)).toFixed(4)) : 0;
    recall[label] = tp + fn > 0 ? Number((tp / (tp + fn)).toFixed(4)) : 0;
    const p = precision[label];
    const r = recall[label];
    f1Score[label] = p + r > 0 ? Number((2 * p * r / (p + r)).toFixed(4)) : 0;
    perClassAccuracy[label] = Number(((tp + tn) / n).toFixed(4));
  }

  const correct = predictedLabels.filter((p, i) => p === trueLabels[i]).length;
  const accuracy = Number((correct / n).toFixed(4));

  return {
    accuracy,
    precision,
    recall,
    f1Score,
    confusionMatrix,
    perClassAccuracy,
    labels: labelNames,
  };
}

/**
 * Save the trained model to browser localStorage (IndexedDB via TF.js).
 */
export async function saveModel(): Promise<void> {
  if (!currentModel) throw new Error('No model to save');
  await currentModel.save('localstorage://sign-language-model');
  localStorage.setItem('sign-language-labels', JSON.stringify(currentLabels));
  localStorage.setItem(FEATURE_VERSION_KEY, String(FEATURE_DIM));
}

/**
 * Load a previously saved model from browser localStorage.
 * Returns false (without loading) if the saved model used the legacy
 * 63-dim input — the user must retrain with the new 156-dim features.
 */
export async function loadModel(): Promise<boolean> {
  try {
    const savedDim = parseInt(localStorage.getItem(FEATURE_VERSION_KEY) ?? '0', 10);
    if (savedDim !== 0 && savedDim !== FEATURE_DIM) {
      // Legacy model — incompatible, signal the caller to prompt retraining
      console.warn(
        `Saved model uses ${savedDim}-dim features; current app expects ${FEATURE_DIM}-dim. Please retrain.`
      );
      return false;
    }

    const model = await tf.loadLayersModel('localstorage://sign-language-model');
    const labelsJson = localStorage.getItem('sign-language-labels');
    if (!labelsJson) return false;
    currentModel = model;
    const parsed: unknown = JSON.parse(labelsJson);
    if (!Array.isArray(parsed)) return false;
    currentLabels = parsed.filter((v): v is string => typeof v === 'string');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current model and labels (for external access).
 */
export function getModelState() {
  return { model: currentModel, labels: currentLabels };
}

/**
 * Check if a model is currently loaded and ready for inference.
 */
export function isModelReady(): boolean {
  return currentModel !== null && currentLabels.length > 0;
}

/**
 * Dispose the current model to free memory.
 */
export function disposeModel(): void {
  if (currentModel) {
    currentModel.dispose();
    currentModel = null;
    currentLabels = [];
  }
}
