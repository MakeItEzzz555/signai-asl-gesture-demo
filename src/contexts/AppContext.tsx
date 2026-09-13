/**
 * AppContext.tsx — Global application state
 *
 * Provides:
 * - Accessibility settings
 * - Dataset management for recording/training
 * - Training configuration and logs
 * - Evaluation metrics
 * - Inference model loading status
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CustomTranslations,
  type LanguageCode,
  LANGUAGES,
  normalizeGestureLabel,
} from '../i18n/translations';
import { disposeModel, getModelSnapshot, subscribeModel } from '../ml/model';
import { syncSpeechPreferences } from '../utils/tts';
import { parseStoredDatasetSnapshot } from '../dataset/datasetUtils';
import { loadDatasetSnapshot, saveDatasetSnapshot, type DatasetStorageSnapshot } from '../dataset/datasetStorage';

export type TextSize = 'normal' | 'large' | 'xl';

export interface Accessibility {
  highContrast: boolean;
  textSize: TextSize;
  audioEnabled: boolean;
  autoSpeak: boolean;
  useCloudTts: boolean;
  language: LanguageCode;
}

export interface GestureSample {
  label: string;
  landmarks: number[];
  timestamp: number;
}

export interface Dataset {
  samples: GestureSample[];
  labels: string[];
}

export type DatasetStorageStatus = 'loading' | 'saving' | 'saved' | 'error';

export interface TrainingConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  validationSplit: number;
}

export interface TrainingLog {
  epoch: number;
  loss: number;
  accuracy: number;
  valLoss: number;
  valAccuracy: number;
}

export interface EvaluationMetrics {
  accuracy: number;
  precision: Record<string, number>;
  recall: Record<string, number>;
  f1Score: Record<string, number>;
  confusionMatrix: number[][];
  perClassAccuracy: Record<string, number>;
  labels: string[];
}

export const DEFAULT_GESTURES = [
  'Hello',
  'Yes',
  'No',
  'Please',
  'Help',
];

interface AppContextType {
  accessibility: Accessibility;
  setAccessibility: (partial: Partial<Accessibility>) => void;

  dataset: Dataset;
  customTranslations: CustomTranslations;
  datasetRevision: number;
  datasetStorageStatus: DatasetStorageStatus;
  datasetStorageError: string | null;
  flushDatasetStorage: () => Promise<boolean>;
  addSample: (sample: GestureSample) => void;
  removeLabel: (label: string) => void;
  clearDataset: () => void;
  importDataset: (samples: GestureSample[]) => void;
  mergeDataset: (samples: GestureSample[]) => void;
  replaceDatasetBundle: (samples: GestureSample[], translations: CustomTranslations) => void;
  mergeDatasetBundle: (samples: GestureSample[], translations: CustomTranslations) => void;
  setCustomTranslation: (label: string, language: LanguageCode, value: string) => void;
  removeCustomTranslations: (label: string) => void;
  mergeCustomTranslations: (translations: CustomTranslations) => void;
  clearCustomTranslations: () => void;

  trainingConfig: TrainingConfig;
  setTrainingConfig: (partial: Partial<TrainingConfig>) => void;
  trainingLogs: TrainingLog[];
  setTrainingLogs: (logs: TrainingLog[]) => void;
  isModelTrained: boolean;
  setIsModelTrained: (trained: boolean) => void;
  evaluationMetrics: EvaluationMetrics | null;
  setEvaluationMetrics: (metrics: EvaluationMetrics | null) => void;

  modelReady: boolean;
  modelLoading: boolean;
  modelError: string | null;
  setModelReady: (ready: boolean) => void;
  setModelLoading: (loading: boolean) => void;
  setModelError: (error: string | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const DEFAULT_ACCESSIBILITY: Accessibility = {
  highContrast: false,
  textSize: 'normal',
  audioEnabled: true,
  autoSpeak: true,
  useCloudTts: false,
  language: 'en',
};

const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  epochs: 30,
  batchSize: 32,
  learningRate: 0.001,
  validationSplit: 0.2,
};

function labelsFromSamples(samples: GestureSample[]): string[] {
  return Array.from(new Set(samples.map(s => s.label)));
}

function createKeyedRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeCustomTranslations(translations: unknown): CustomTranslations {
  if (!isPlainObject(translations)) return createKeyedRecord<Partial<Record<LanguageCode, string>>>();

  const validLanguages = new Set<LanguageCode>(LANGUAGES.map(l => l.code));
  const normalized = createKeyedRecord<Partial<Record<LanguageCode, string>>>();

  for (const [label, entries] of Object.entries(translations)) {
    const labelKey = normalizeGestureLabel(label);
    if (!labelKey || !isPlainObject(entries)) continue;

    for (const [lang, value] of Object.entries(entries)) {
      if (!validLanguages.has(lang as LanguageCode) || typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      normalized[labelKey] = {
        ...normalized[labelKey],
        [lang]: trimmed,
      };
    }
  }

  return normalized;
}

function mergeTranslations(current: CustomTranslations, incoming: CustomTranslations): CustomTranslations {
  const next = Object.assign(createKeyedRecord<Partial<Record<LanguageCode, string>>>(), current);
  for (const [label, entries] of Object.entries(normalizeCustomTranslations(incoming))) {
    next[label] = { ...(Object.hasOwn(next, label) ? next[label] : {}), ...entries };
  }
  return next;
}

function readAccessibility(): Accessibility {
  if (typeof localStorage === 'undefined') return DEFAULT_ACCESSIBILITY;
  try {
    const stored = localStorage.getItem('signai:accessibility');
    if (!stored) return DEFAULT_ACCESSIBILITY;
    const parsed = JSON.parse(stored);
    if (!isPlainObject(parsed)) return DEFAULT_ACCESSIBILITY;
    return {
      highContrast: typeof parsed.highContrast === 'boolean' ? parsed.highContrast : DEFAULT_ACCESSIBILITY.highContrast,
      textSize: parsed.textSize === 'large' || parsed.textSize === 'xl' || parsed.textSize === 'normal'
        ? parsed.textSize
        : DEFAULT_ACCESSIBILITY.textSize,
      audioEnabled: typeof parsed.audioEnabled === 'boolean' ? parsed.audioEnabled : DEFAULT_ACCESSIBILITY.audioEnabled,
      autoSpeak: typeof parsed.autoSpeak === 'boolean' ? parsed.autoSpeak : DEFAULT_ACCESSIBILITY.autoSpeak,
      useCloudTts: typeof parsed.useCloudTts === 'boolean' ? parsed.useCloudTts : DEFAULT_ACCESSIBILITY.useCloudTts,
      language: typeof parsed.language === 'string' && LANGUAGES.some(language => language.code === parsed.language)
        ? parsed.language as LanguageCode
        : DEFAULT_ACCESSIBILITY.language,
    };
  } catch {
    return DEFAULT_ACCESSIBILITY;
  }
}

function readLegacyCustomTranslations(): CustomTranslations {
  if (typeof localStorage === 'undefined') return createKeyedRecord<Partial<Record<LanguageCode, string>>>();
  try {
    const stored = localStorage.getItem('signai:customTranslations');
    return stored ? normalizeCustomTranslations(JSON.parse(stored)) : createKeyedRecord<Partial<Record<LanguageCode, string>>>();
  } catch {
    return createKeyedRecord<Partial<Record<LanguageCode, string>>>();
  }
}

interface DurableDatasetState {
  dataset: Dataset;
  customTranslations: CustomTranslations;
  revision: number;
}

function emptyDurableDatasetState(): DurableDatasetState {
  return {
    dataset: { samples: [], labels: [] },
    customTranslations: createKeyedRecord<Partial<Record<LanguageCode, string>>>(),
    revision: 0,
  };
}

function snapshotFromState(state: DurableDatasetState): DatasetStorageSnapshot {
  return {
    schemaVersion: 1,
    revision: state.revision,
    samples: state.dataset.samples,
    customTranslations: state.customTranslations,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [accessibility, setAccessibilityState] = useState<Accessibility>(readAccessibility);
  const initialDatasetState = useRef(emptyDurableDatasetState()).current;
  const [durableDatasetState, setDurableDatasetState] = useState<DurableDatasetState>(initialDatasetState);
  const durableDatasetStateRef = useRef(durableDatasetState);
  const [datasetStorageStatus, setDatasetStorageStatus] = useState<DatasetStorageStatus>('loading');
  const [datasetStorageError, setDatasetStorageError] = useState<string | null>(null);
  const datasetStorageStatusRef = useRef<DatasetStorageStatus>('loading');
  const storageRecoveryRequiredRef = useRef(false);
  const hydratedRef = useRef(false);
  const writeQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const latestWriteRef = useRef(0);

  const [trainingConfig, setTrainingConfigState] = useState<TrainingConfig>(DEFAULT_TRAINING_CONFIG);
  const [trainingLogs, setTrainingLogs] = useState<TrainingLog[]>([]);
  const [isModelTrained, setIsModelTrained] = useState(false);
  const [evaluationMetrics, setEvaluationMetrics] = useState<EvaluationMetrics | null>(null);

  useEffect(() => {
    const sync = () => {
      const model = getModelSnapshot();
      setTrainingLogs(model.logs);
      setIsModelTrained(model.ready);
      setEvaluationMetrics(model.metrics);
    };
    sync();
    return subscribeModel(sync);
  }, []);

  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const setStorageStatus = useCallback((status: DatasetStorageStatus, error: string | null = null) => {
    datasetStorageStatusRef.current = status;
    setDatasetStorageStatus(status);
    setDatasetStorageError(error);
  }, []);

  const queueSnapshotWrite = useCallback((snapshot: DatasetStorageSnapshot): Promise<boolean> => {
    setStorageStatus('saving');
    const writeId = ++latestWriteRef.current;
    const write = async (): Promise<{ saved: boolean; error: string | null }> => {
      try {
        await saveDatasetSnapshot(snapshot);
        return { saved: true, error: null };
      } catch (error) {
        return {
          saved: false,
          error: error instanceof Error ? error.message : 'Could not save browser dataset storage',
        };
      }
    };
    const queued = writeQueueRef.current.then(write, write);
    const settled = queued.then(result => {
      if (writeId === latestWriteRef.current) {
        setStorageStatus(result.saved ? 'saved' : 'error', result.error);
      }
      return result.saved;
    });
    writeQueueRef.current = settled;
    return settled;
  }, [setStorageStatus]);

  const flushDatasetStorage = useCallback(() => writeQueueRef.current, []);

  const setAccessibility = useCallback((partial: Partial<Accessibility>) => {
    setAccessibilityState(prev => ({ ...prev, ...partial }));
  }, []);

  const setTrainingConfig = useCallback((partial: Partial<TrainingConfig>) => {
    setTrainingConfigState(prev => ({ ...prev, ...partial }));
  }, []);

  const resetTrainingState = useCallback(() => {
    disposeModel();
    setTrainingLogs([]);
    setIsModelTrained(false);
    setEvaluationMetrics(null);
  }, []);

  const applyDatasetMutation = useCallback((
    update: (current: DurableDatasetState) => DurableDatasetState,
    contentChanged: boolean,
    recoverCorruptStorage = false,
  ) => {
    if (!hydratedRef.current || (storageRecoveryRequiredRef.current && !recoverCorruptStorage)) return;
    if (recoverCorruptStorage) storageRecoveryRequiredRef.current = false;
    const next = update(durableDatasetStateRef.current);
    durableDatasetStateRef.current = next;
    setDurableDatasetState(next);
    void queueSnapshotWrite(snapshotFromState(next));
    if (contentChanged) resetTrainingState();
  }, [queueSnapshotWrite, resetTrainingState]);

  const addSample = useCallback((sample: GestureSample) => {
    const label = sample.label.trim();
    if (!label) return;
    applyDatasetMutation(current => {
      const samples = [...current.dataset.samples, { ...sample, label }];
      return { ...current, dataset: { samples, labels: labelsFromSamples(samples) }, revision: current.revision + 1 };
    }, true);
  }, [applyDatasetMutation]);

  const removeLabel = useCallback((label: string) => {
    applyDatasetMutation(current => {
      const samples = current.dataset.samples.filter(sample => sample.label !== label);
      const translations = Object.assign(createKeyedRecord<Partial<Record<LanguageCode, string>>>(), current.customTranslations);
      delete translations[normalizeGestureLabel(label)];
      return {
        dataset: { samples, labels: labelsFromSamples(samples) },
        customTranslations: translations,
        revision: current.revision + 1,
      };
    }, true);
  }, [applyDatasetMutation]);

  const clearDataset = useCallback(() => {
    applyDatasetMutation(current => ({
      dataset: { samples: [], labels: [] },
      customTranslations: createKeyedRecord<Partial<Record<LanguageCode, string>>>(),
      revision: current.revision + 1,
    }), true, true);
  }, [applyDatasetMutation]);

  const importDataset = useCallback((samples: GestureSample[]) => {
    applyDatasetMutation(current => ({
      dataset: { samples, labels: labelsFromSamples(samples) },
      customTranslations: createKeyedRecord<Partial<Record<LanguageCode, string>>>(),
      revision: current.revision + 1,
    }), true, true);
  }, [applyDatasetMutation]);

  const mergeDataset = useCallback((samples: GestureSample[]) => {
    applyDatasetMutation(current => {
      const mergedSamples = [...current.dataset.samples, ...samples];
      return { ...current, dataset: { samples: mergedSamples, labels: labelsFromSamples(mergedSamples) }, revision: current.revision + 1 };
    }, true);
  }, [applyDatasetMutation]);

  const replaceDatasetBundle = useCallback((samples: GestureSample[], translations: CustomTranslations) => {
    applyDatasetMutation(current => ({
      dataset: { samples, labels: labelsFromSamples(samples) },
      customTranslations: normalizeCustomTranslations(translations),
      revision: current.revision + 1,
    }), true, true);
  }, [applyDatasetMutation]);

  const mergeDatasetBundle = useCallback((samples: GestureSample[], translations: CustomTranslations) => {
    applyDatasetMutation(current => {
      const mergedSamples = [...current.dataset.samples, ...samples];
      return {
        dataset: { samples: mergedSamples, labels: labelsFromSamples(mergedSamples) },
        customTranslations: mergeTranslations(current.customTranslations, translations),
        revision: current.revision + 1,
      };
    }, true);
  }, [applyDatasetMutation]);

  const setCustomTranslation = useCallback((label: string, language: LanguageCode, value: string) => {
    const labelKey = normalizeGestureLabel(label);
    const trimmed = value.trim();
    if (!labelKey) return;

    applyDatasetMutation(current => {
      const translations = Object.assign(createKeyedRecord<Partial<Record<LanguageCode, string>>>(), current.customTranslations);
      const currentEntry = Object.hasOwn(translations, labelKey) ? translations[labelKey] : {};
      if (!trimmed) {
        const nextEntry = { ...currentEntry };
        delete nextEntry[language];
        if (Object.keys(nextEntry).length === 0) {
          delete translations[labelKey];
        } else {
          translations[labelKey] = nextEntry;
        }
        return { ...current, customTranslations: translations };
      }

      translations[labelKey] = { ...currentEntry, [language]: trimmed };
      return { ...current, customTranslations: translations };
    }, false);
  }, [applyDatasetMutation]);

  const removeCustomTranslations = useCallback((label: string) => {
    applyDatasetMutation(current => {
      const translations = Object.assign(createKeyedRecord<Partial<Record<LanguageCode, string>>>(), current.customTranslations);
      delete translations[normalizeGestureLabel(label)];
      return { ...current, customTranslations: translations };
    }, false);
  }, [applyDatasetMutation]);

  const mergeCustomTranslations = useCallback((translations: CustomTranslations) => {
    applyDatasetMutation(current => ({
      ...current,
      customTranslations: mergeTranslations(current.customTranslations, translations),
    }), false);
  }, [applyDatasetMutation]);

  const clearCustomTranslations = useCallback(() => {
    applyDatasetMutation(current => ({
      ...current,
      customTranslations: createKeyedRecord<Partial<Record<LanguageCode, string>>>(),
    }), false);
  }, [applyDatasetMutation]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const stored = await loadDatasetSnapshot();
        if (cancelled) return;
        if (stored === null) {
          const legacyTranslations = readLegacyCustomTranslations();
          const initial = {
            ...emptyDurableDatasetState(),
            customTranslations: legacyTranslations,
          };
          durableDatasetStateRef.current = initial;
          setDurableDatasetState(initial);
          hydratedRef.current = true;
          setStorageStatus('saved');
          if (Object.keys(legacyTranslations).length > 0) void queueSnapshotWrite(snapshotFromState(initial));
          return;
        }

        const snapshot = parseStoredDatasetSnapshot(stored);
        const restored: DurableDatasetState = {
          dataset: { samples: snapshot.samples, labels: labelsFromSamples(snapshot.samples) },
          customTranslations: snapshot.customTranslations,
          revision: snapshot.revision,
        };
        durableDatasetStateRef.current = restored;
        setDurableDatasetState(restored);
        hydratedRef.current = true;
        setStorageStatus('saved');
      } catch (error) {
        if (cancelled) return;
        hydratedRef.current = true;
        storageRecoveryRequiredRef.current = true;
        setStorageStatus('error', error instanceof Error ? error.message : 'Could not restore browser dataset storage');
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [queueSnapshotWrite, setStorageStatus]);

  useEffect(() => {
    const releaseModelResources = () => disposeModel();
    window.addEventListener('pagehide', releaseModelResources);
    return () => window.removeEventListener('pagehide', releaseModelResources);
  }, []);

  // Sync useCloudTts preference into the TTS routing module.
  useEffect(() => {
    syncSpeechPreferences({ audioEnabled: accessibility.audioEnabled, useCloudVoices: accessibility.useCloudTts, language: accessibility.language });
  }, [accessibility.audioEnabled, accessibility.useCloudTts, accessibility.language]);

  // Persist accessibility settings to localStorage on every change.
  useEffect(() => {
    try {
      localStorage.setItem('signai:accessibility', JSON.stringify(accessibility));
    } catch {
      // Accessibility preferences remain usable for this session when storage is unavailable.
    }
  }, [accessibility]);

  useEffect(() => {
    const root = document.documentElement;
    if (accessibility.highContrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }

    root.classList.remove('text-size-normal', 'text-size-large', 'text-size-xl');
    root.classList.add(`text-size-${accessibility.textSize}`);
  }, [accessibility.highContrast, accessibility.textSize]);

  const value = useMemo<AppContextType>(() => ({
    accessibility,
    setAccessibility,

    dataset: durableDatasetState.dataset,
    customTranslations: durableDatasetState.customTranslations,
    datasetRevision: durableDatasetState.revision,
    datasetStorageStatus,
    datasetStorageError,
    flushDatasetStorage,
    addSample,
    removeLabel,
    clearDataset,
    importDataset,
    mergeDataset,
    replaceDatasetBundle,
    mergeDatasetBundle,
    setCustomTranslation,
    removeCustomTranslations,
    mergeCustomTranslations,
    clearCustomTranslations,

    trainingConfig,
    setTrainingConfig,
    trainingLogs,
    setTrainingLogs,
    isModelTrained,
    setIsModelTrained,
    evaluationMetrics,
    setEvaluationMetrics,

    modelReady,
    modelLoading,
    modelError,
    setModelReady,
    setModelLoading,
    setModelError,
  }), [
    accessibility,
    setAccessibility,
    durableDatasetState,
    datasetStorageStatus,
    datasetStorageError,
    flushDatasetStorage,
    addSample,
    removeLabel,
    clearDataset,
    importDataset,
    mergeDataset,
    replaceDatasetBundle,
    mergeDatasetBundle,
    setCustomTranslation,
    removeCustomTranslations,
    mergeCustomTranslations,
    clearCustomTranslations,
    trainingConfig,
    setTrainingConfig,
    trainingLogs,
    isModelTrained,
    evaluationMetrics,
    modelReady,
    modelLoading,
    modelError,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
