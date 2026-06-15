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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  type CustomTranslations,
  type LanguageCode,
  LANGUAGES,
  normalizeGestureLabel,
} from '../i18n/translations';
import { disposeModel } from '../ml/model';
import { setCloudVoicesEnabled } from '../utils/tts';

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
  addSample: (sample: GestureSample) => void;
  removeLabel: (label: string) => void;
  clearDataset: () => void;
  importDataset: (samples: GestureSample[]) => void;
  mergeDataset: (samples: GestureSample[]) => void;
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

function normalizeCustomTranslations(translations: unknown): CustomTranslations {
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return {};

  const validLanguages = new Set<LanguageCode>(LANGUAGES.map(l => l.code));
  const normalized: CustomTranslations = {};

  for (const [label, entries] of Object.entries(translations as Record<string, unknown>)) {
    const labelKey = normalizeGestureLabel(label);
    if (!labelKey || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;

    for (const [lang, value] of Object.entries(entries as Record<string, unknown>)) {
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [accessibility, setAccessibilityState] = useState<Accessibility>(DEFAULT_ACCESSIBILITY);

  const [dataset, setDataset] = useState<Dataset>({
    samples: [],
    labels: [],
  });
  const [customTranslations, setCustomTranslations] = useState<CustomTranslations>({});

  const [trainingConfig, setTrainingConfigState] = useState<TrainingConfig>(DEFAULT_TRAINING_CONFIG);
  const [trainingLogs, setTrainingLogs] = useState<TrainingLog[]>([]);
  const [isModelTrained, setIsModelTrained] = useState(false);
  const [evaluationMetrics, setEvaluationMetrics] = useState<EvaluationMetrics | null>(null);

  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

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

  const addSample = useCallback((sample: GestureSample) => {
    setDataset(prev => {
      const labels = prev.labels.includes(sample.label)
        ? prev.labels
        : [...prev.labels, sample.label];
      return {
        labels,
        samples: [...prev.samples, sample],
      };
    });
    resetTrainingState();
  }, [resetTrainingState]);

  const removeLabel = useCallback((label: string) => {
    setDataset(prev => ({
      labels: prev.labels.filter(l => l !== label),
      samples: prev.samples.filter(s => s.label !== label),
    }));
    setCustomTranslations(prev => {
      const next = { ...prev };
      delete next[normalizeGestureLabel(label)];
      return next;
    });
    resetTrainingState();
  }, [resetTrainingState]);

  const clearDataset = useCallback(() => {
    setDataset({ samples: [], labels: [] });
    setCustomTranslations({});
    resetTrainingState();
  }, [resetTrainingState]);

  const importDataset = useCallback((samples: GestureSample[]) => {
    const labels = labelsFromSamples(samples);
    setDataset({ samples, labels });
    resetTrainingState();
  }, [resetTrainingState]);

  const mergeDataset = useCallback((samples: GestureSample[]) => {
    setDataset(prev => {
      const mergedSamples = [...prev.samples, ...samples];
      return {
        samples: mergedSamples,
        labels: labelsFromSamples(mergedSamples),
      };
    });
    resetTrainingState();
  }, [resetTrainingState]);

  const setCustomTranslation = useCallback((label: string, language: LanguageCode, value: string) => {
    const labelKey = normalizeGestureLabel(label);
    const trimmed = value.trim();
    if (!labelKey) return;

    setCustomTranslations(prev => {
      const current = prev[labelKey] ?? {};
      if (!trimmed) {
        const nextEntry = { ...current };
        delete nextEntry[language];
        const next = { ...prev };
        if (Object.keys(nextEntry).length === 0) {
          delete next[labelKey];
        } else {
          next[labelKey] = nextEntry;
        }
        return next;
      }

      return {
        ...prev,
        [labelKey]: {
          ...current,
          [language]: trimmed,
        },
      };
    });
  }, []);

  const removeCustomTranslations = useCallback((label: string) => {
    setCustomTranslations(prev => {
      const next = { ...prev };
      delete next[normalizeGestureLabel(label)];
      return next;
    });
  }, []);

  const mergeCustomTranslations = useCallback((translations: CustomTranslations) => {
    const normalized = normalizeCustomTranslations(translations);
    setCustomTranslations(prev => {
      const next: CustomTranslations = { ...prev };
      for (const [label, entries] of Object.entries(normalized)) {
        next[label] = {
          ...(next[label] ?? {}),
          ...entries,
        };
      }
      return next;
    });
  }, []);

  const clearCustomTranslations = useCallback(() => {
    setCustomTranslations({});
  }, []);

  // Restore accessibility settings from localStorage on first mount.
  useEffect(() => {
    const stored = localStorage.getItem('signai:accessibility');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<Accessibility>;
        // Guard: if a previously-valid language was removed from the app, reset to English.
        if (parsed.language && !LANGUAGES.some(l => l.code === parsed.language)) {
          parsed.language = 'en';
        }
        setAccessibilityState(prev => ({ ...prev, ...parsed }));
      } catch {
        // ignore malformed data
      }
    }
  }, []);

  // Restore custom gesture translations from localStorage on first mount.
  useEffect(() => {
    const stored = localStorage.getItem('signai:customTranslations');
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as CustomTranslations;
      setCustomTranslations(normalizeCustomTranslations(parsed));
    } catch {
      // ignore malformed data
    }
  }, []);

  // Sync useCloudTts preference into the TTS routing module.
  useEffect(() => {
    setCloudVoicesEnabled(accessibility.useCloudTts);
  }, [accessibility.useCloudTts]);

  // Persist accessibility settings to localStorage on every change.
  useEffect(() => {
    localStorage.setItem('signai:accessibility', JSON.stringify(accessibility));
  }, [accessibility]);

  useEffect(() => {
    localStorage.setItem('signai:customTranslations', JSON.stringify(customTranslations));
  }, [customTranslations]);

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

    dataset,
    customTranslations,
    addSample,
    removeLabel,
    clearDataset,
    importDataset,
    mergeDataset,
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
    dataset,
    customTranslations,
    addSample,
    removeLabel,
    clearDataset,
    importDataset,
    mergeDataset,
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
