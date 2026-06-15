/**
 * RecognizePage.tsx — Live dynamic ASL gesture recognition
 *
 * Uses ONNX Attention-BiGRU sequence inference:
 * - Rolling 30-frame buffer
 * - Per-frame confidence/stability updates
 * - Word emitted when confidence/stability thresholds are met
 * - Emitted words sit in a "pending" state until the user confirms them
 *
 */

import { useState, useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Camera,
  Volume2,
  VolumeX,
  StopCircle,
  Trash2,
  AlertCircle,
  CheckCircle,
  Loader,
  X,
  BookOpen,
} from 'lucide-react';
import { DEFAULT_GESTURES, useApp } from '../contexts/AppContext';
import { useMediaPipe, type FaceRegion, type HandFaceInteraction } from '../hooks/useMediaPipe';
import {
  DEFAULT_SEGMENTATION_CONFIG,
  SEQUENCE_FRAMES,
  predict as predictOnnx,
  isFaceInteractiveLabel,
  isModelReady as isOnnxModelReady,
  resetPredictionState as resetOnnxPredictionState,
  type SegmentationState,
  type SequencePrediction,
} from '../ml/inferenceModel';
import { SegmentationFSM } from '../ml/segmentationFSM';
import {
  CUSTOM_ACTIVATE_CONFIDENCE,
  CUSTOM_ACTIVATE_MARGIN,
  HybridRouter,
  ONNX_ACTIVATE_CONFIDENCE,
  type HybridSource,
} from '../ml/hybridRouter';
import {
  predict as predictCustomModel,
  isModelReady as isCustomModelReady,
  loadModel as loadCustomModel,
} from '../ml/model';
import {
  type Landmark,
} from '../utils/landmarks';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { translateGesture, LANGUAGE_BCP47, LANGUAGES } from '../i18n/translations';
import { speak, preWarmVoices } from '../utils/tts';
import { preWarmPiper, piperHasVoice } from '../utils/piperFallback';
import GestureGuide from '../components/GestureGuide';
import LanguageSelector from '../components/LanguageSelector';

const CONFIRMATION_FRAMES = DEFAULT_SEGMENTATION_CONFIG.confirmFrames;
const BUFFER_FRAMES = SEQUENCE_FRAMES;
const CUSTOM_SEGMENTATION_CONFIG = {
  ...DEFAULT_SEGMENTATION_CONFIG,
  confidenceThreshold: CUSTOM_ACTIVATE_CONFIDENCE / 100,
  confirmFrames: SEQUENCE_FRAMES + 4,
};
const CUSTOM_LABEL_SWITCH_FRAMES = 4;

type RecognizerMode = 'onnx' | 'hybrid';

// Number of frames to hold the "face interaction active" flag after the last
// detected interaction.  Prevents a single missed detection frame from briefly
// un-suppressing hand-only output mid-gesture.
const FACE_INTERACTION_HOLD = 16;
const HAND_IMG = 'https://private-us-east-1.manuscdn.com/sessionFile/4iXw0AOERkK4bJszd4LVcS/sandbox/AM4gAxP42WhibloDBqGRo8-img-2_1772125094000_na1fn_aGFuZC1sYW5kbWFya3M.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvNGlYdzBBT0VSa0s0YkpzemQ0TFZjUy9zYW5kYm94L0FNNGdBeFA0MldoaWJsb0RCcUdSbzgtaW1nLTJfMTc3MjEyNTA5NDAwMF9uYTFmbl9hR0Z1WkMxc1lXNWtiV0Z5YTNNLnBuZz94LW9zcy1wcm9jZXNzPWltYWdlL3Jlc2l6ZSx3XzE5MjAsaF8xOTIwL2Zvcm1hdCx3ZWJwL3F1YWxpdHkscV84MCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc5ODc2MTYwMH19fV19&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=d6riQjn4rbiFcMw~1ofAg14udAxVDb3JjMs53iEgnOvVt3203S0YyZwAlkvxWIe6OOkG3W5rVjyJpwcGudPZ6nCpDSGAMslgsjpktJSVVp8zFF14GpLiT9nTgVnGTKWvqEVhyA0q00PuplWqoEpCO~5eeVNNla0batvoWIhEytgjiKwoWHXIvjeBSUeS3S0vQvak6Bdz6pL5VYZTMOl0G9UPcK7FPS9EzbtNNNvR806wOPO1fhcYj5cuNxTrh13U0sD6dO385-jRfPiomI9Lhwi5pzMJ8MR0QKf5GlF-kUrfW4~ZpzZ9sauCSv2bHIpZHnioCOKyKoHmhyiwHnZY8g__';


const FACE_REGION_LABEL: Record<FaceRegion, string> = {
  mouth: 'Mouth',
  eye: 'Eye',
  nose: 'Nose',
  forehead: 'Forehead',
  ear: 'Ear',
};

const COMBINED_GESTURE_BY_REGION: Record<FaceRegion, string> = {
  mouth: 'Eat / Speak',
  eye: 'See / Look',
  nose: 'Smell',
  forehead: 'Think',
  ear: 'Listen',
};

function getCombinedGestureLabel(gesture: string | null, faceRegion: FaceRegion): string {
  const normalized = (gesture ?? '').trim().toLowerCase();
  if (normalized && isFaceInteractiveLabel(normalized)) return normalized;
  return COMBINED_GESTURE_BY_REGION[faceRegion] ?? (gesture ?? 'Combined Gesture');
}

function canonicalLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, ' ');
}

const DEFAULT_GESTURE_LABELS = new Set(DEFAULT_GESTURES.map(canonicalLabel));

function isDefaultGestureLabel(label: string): boolean {
  return DEFAULT_GESTURE_LABELS.has(canonicalLabel(label));
}

function sameGestureLabel(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && canonicalLabel(a) === canonicalLabel(b));
}

function getCustomGestureCandidate(result: ReturnType<typeof predictCustomModel>): {
  label: string;
  confidence: number;
} | null {
  if (!result || result.allScores.length === 0) return null;

  const top = result.allScores[0];
  const secondScore = result.allScores[1]?.score ?? 0;
  const margin = top.score - secondScore;

  if (isDefaultGestureLabel(top.label)) return null;
  if (top.score < CUSTOM_ACTIVATE_CONFIDENCE) return null;
  if (margin < CUSTOM_ACTIVATE_MARGIN) return null;

  return {
    label: top.label,
    confidence: top.score,
  };
}

const FACE_REGION_GUARD: Record<string, FaceRegion[]> = {
  think: ['forehead'],
  know: ['forehead', 'eye'],
  father: ['forehead'],
  mother: ['mouth'],
  eat: ['mouth'],
  drink: ['mouth'],
  sleep: ['eye'],
  hot: ['mouth'],
  beautiful: ['forehead', 'mouth'],
  old: ['mouth'],
};

function shouldEmitGesture(
  label: string,
  interaction: HandFaceInteraction | null | undefined,
): boolean {
  const normalized = label.trim().toLowerCase();

  if (isFaceInteractiveLabel(normalized)) {
    if (!interaction) return false;
    const allowedRegions = FACE_REGION_GUARD[normalized];
    if (allowedRegions && !allowedRegions.includes(interaction.faceRegion)) return false;
  }

  return true;
}

function formatHybridSource(source: HybridSource): string {
  if (source === 'ONNX_ACTIVE') return 'ONNX';
  if (source === 'CUSTOM_ACTIVE') return 'Custom';
  return 'Idle';
}

interface RecognizedWord {
  word: string;
  confidence: number;
  timestamp: number;
}

interface CustomFramePrediction {
  candidateLabel: string | null;
  liveLabel: string | null;
  confidence: number;
  allScores: { label: string; score: number }[];
  fsmState: SegmentationState;
  stableCount: number;
  cooldownFrames: number;
  blankStableCount: number;
  blankStableRequired: number;
  emittedWord: string | null;
}

// ---------------------------------------------------------------------------
// Prediction state — consolidated into a single useReducer to avoid 8+
// separate setState calls firing on every inference tick (~30 FPS).
// ---------------------------------------------------------------------------

interface PredictionState {
  // Primary hand
  currentGesture: string | null;
  pendingWord: string | null;
  pendingConfidence: number;
  liveGesture: string | null;
  liveConfidence: number;           // right-hand current-frame confidence
  currentConfidence: number;
  isConfirmed: boolean;
  fsmState: SegmentationState;
  stableCount: number;
  cooldownFrames: number;
  blankStableCount: number;
  blankStableRequired: number;
  bufferSize: number;
  motionEnergy: number;
  topPredictions: { label: string; score: number }[];
  hybridSource: HybridSource;
}

const INITIAL_PRED_STATE: PredictionState = {
  currentGesture: null,
  pendingWord: null,
  pendingConfidence: 0,
  liveGesture: null,
  liveConfidence: 0,
  currentConfidence: 0,
  isConfirmed: false,
  fsmState: 'IDLE',
  stableCount: 0,
  cooldownFrames: 0,
  blankStableCount: 0,
  blankStableRequired: DEFAULT_SEGMENTATION_CONFIG.blankStableFrames,
  bufferSize: 0,
  motionEnergy: 0,
  topPredictions: [],
  hybridSource: 'IDLE',
};

type PredictionAction =
  | { type: 'UPDATE_RIGHT'; result: SequencePrediction; source?: HybridSource }
  | {
      type: 'UPDATE_CUSTOM';
      result: {
        liveLabel: string | null;
        liveConfidence: number;
        allScores: { label: string; score: number }[];
        fsmState: SegmentationState;
        stableCount: number;
        cooldownFrames: number;
        blankStableCount: number;
        blankStableRequired: number;
        emittedWord: string | null;
        source: HybridSource;
      };
    }
  | { type: 'CONFIRM_PENDING' }
  | { type: 'DISCARD_PENDING' }
  | { type: 'RESET' };

function applyRightUpdate(state: PredictionState, result: SequencePrediction, source: HybridSource = 'ONNX_ACTIVE'): PredictionState {
  const liveLabel = result.liveLabel === 'blank' ? null : result.liveLabel;
  const next: PredictionState = {
    ...state,
    liveGesture: liveLabel,
    liveConfidence: liveLabel ? result.liveConfidence : 0,
    fsmState: result.state,
    stableCount: result.stableCount,
    cooldownFrames: result.cooldown,
    blankStableCount: result.blankStableCount,
    blankStableRequired: result.blankStableRequired,
    bufferSize: result.bufferSize,
    motionEnergy: result.motionEnergy,
    topPredictions: result.allScores.filter(s => s.label !== 'blank').slice(0, 3),
    isConfirmed: Boolean(result.lastCompletedWord),
    currentGesture: result.lastCompletedWord ?? state.currentGesture,
    hybridSource: source,
  };
  if (result.emittedWord) {
    return {
      ...next,
      currentGesture: result.emittedWord,
      currentConfidence: result.liveConfidence,
      pendingWord: result.emittedWord,
      pendingConfidence: result.liveConfidence,
      isConfirmed: true,
    };
  }
  return next;
}

function predictionReducer(state: PredictionState, action: PredictionAction): PredictionState {
  switch (action.type) {
    case 'UPDATE_RIGHT':
      return applyRightUpdate(state, action.result, action.source);

    case 'UPDATE_CUSTOM': {
      const displayGesture = action.result.emittedWord
        ?? action.result.liveLabel
        ?? state.currentGesture;
      const displayConfidence = action.result.emittedWord || action.result.liveLabel
        ? action.result.liveConfidence
        : state.currentConfidence;
      const isConfirmed = action.result.emittedWord
        ? true
        : state.isConfirmed && (!action.result.liveLabel || action.result.liveLabel === state.currentGesture);
      const next: PredictionState = {
        ...state,
        currentGesture: displayGesture,
        currentConfidence: displayConfidence,
        liveGesture: action.result.liveLabel,
        liveConfidence: action.result.liveConfidence,
        fsmState: action.result.fsmState,
        stableCount: action.result.stableCount,
        cooldownFrames: action.result.cooldownFrames,
        blankStableCount: action.result.blankStableCount,
        blankStableRequired: action.result.blankStableRequired,
        bufferSize: action.result.liveLabel ? 1 : 0,
        motionEnergy: 0,
        topPredictions: action.result.allScores.filter(s => s.label !== 'blank').slice(0, 3),
        isConfirmed,
        hybridSource: action.result.source,
      };
      if (!action.result.emittedWord) return next;
      return {
        ...next,
        currentGesture: action.result.emittedWord,
        currentConfidence: action.result.liveConfidence,
        pendingWord: action.result.emittedWord,
        pendingConfidence: action.result.liveConfidence,
        isConfirmed: true,
      };
    }

    case 'CONFIRM_PENDING':
      return { ...state, pendingWord: null, pendingConfidence: 0 };

    case 'DISCARD_PENDING':
      return {
        ...state,
        pendingWord: null,
        pendingConfidence: 0,
        currentGesture: null,
        currentConfidence: 0,
        isConfirmed: false,
      };

    case 'RESET':
      return INITIAL_PRED_STATE;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------

export default function RecognizePage() {
  const {
    accessibility,
    setAccessibility,
    customTranslations,
    modelReady,
    modelLoading,
    modelError,
    isModelTrained,
  } = useApp();
  const language = accessibility.language;
  const [pred, dispatch] = useReducer(predictionReducer, INITIAL_PRED_STATE);
  const [recognizedWords, setRecognizedWords] = useState<RecognizedWord[]>([]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [recognizerMode, setRecognizerMode] = useState<RecognizerMode>('onnx');
  const [customModelReady, setCustomModelReady] = useState(isCustomModelReady());
  const [customModelLoading, setCustomModelLoading] = useState(false);
  const [customModelNotice, setCustomModelNotice] = useState<string | null>(null);
  const recognizerModeRef = useRef<RecognizerMode>('onnx');
  const rightBusyRef = useRef(false);
  const rightLiveGestureRef = useRef<string | null>(null);
  const hybridRouterRef = useRef(new HybridRouter());
  const customFsmRef = useRef(new SegmentationFSM(CUSTOM_SEGMENTATION_CONFIG));
  const pendingCustomSwitchRef = useRef<{ label: string | null; frames: number }>({ label: null, frames: 0 });
  const lastEmittedHandOnlyWordRef = useRef<string | null>(null);
  const handReleasedSinceLastEmitRef = useRef(true);

  // Stable refs so onLandmarks (empty deps) always reads current values
  // without needing to recreate the callback on every change.
  const autoSpeakRef = useRef(accessibility.autoSpeak);
  const audioEnabledRef = useRef(accessibility.audioEnabled);
  const languageRef = useRef(accessibility.language);
  const customTranslationsRef = useRef(customTranslations);

  // Stable setter (React guarantees identity, captured in ref for the
  // empty-deps contract on onLandmarks).
  const setRecognizedWordsRef = useRef(setRecognizedWords);

  // Deduplicated "no voice" toast — one per language base code per session.
  const warnedRef = useRef(new Set<string>());
  const onMissingVoice = useCallback((lang: string) => {
    const base = lang.split('-')[0];
    if (warnedRef.current.has(base)) return;
    warnedRef.current.add(base);
    const name = LANGUAGES.find(l => l.code === base)?.nativeName ?? lang;
    toast.warning(`No ${name} voice is installed on this device — speech is unavailable for this language.`);
  }, []);
  const onMissingVoiceRef = useRef(onMissingVoice);

  // Face-interaction priority gate.
  const faceActiveRef        = useRef(false);
  const emittedFaceRegionRef = useRef<FaceRegion | null>(null);
  const faceHoldRef          = useRef(0);

  const resetCustomPredictionState = useCallback(() => {
    customFsmRef.current.reset();
    hybridRouterRef.current.reset();
    pendingCustomSwitchRef.current = { label: null, frames: 0 };
    lastEmittedHandOnlyWordRef.current = null;
    handReleasedSinceLastEmitRef.current = true;
  }, []);

  useEffect(() => {
    autoSpeakRef.current = accessibility.autoSpeak;
    audioEnabledRef.current = accessibility.audioEnabled;
    languageRef.current = accessibility.language;
  }, [accessibility.autoSpeak, accessibility.audioEnabled, accessibility.language]);

  useEffect(() => {
    customTranslationsRef.current = customTranslations;
  }, [customTranslations]);

  useEffect(() => {
    recognizerModeRef.current = recognizerMode;
  }, [recognizerMode]);

  useEffect(() => {
    setCustomModelReady(isCustomModelReady());
  }, [isModelTrained]);

  useEffect(() => { preWarmVoices(); }, []);

  // Pre-warm the Piper model for the current language whenever it changes.
  // The model download starts immediately in the background; eSpeak bridges
  // until it is ready.  Runs on initial mount to catch the startup language.
  useEffect(() => {
    if (!accessibility.audioEnabled) return;
    if (piperHasVoice(accessibility.language)) {
      void preWarmPiper(accessibility.language);
    }
  }, [accessibility.language, accessibility.audioEnabled]);

  // Sentence is derived from recognizedWords (stored in English) translated
  // at render time — switching language instantly retranslates the whole output.
  const displaySentence = useMemo(
    () => [...recognizedWords].reverse()
      .map(w => translateGesture(w.word, language, customTranslations))
      .join(' '),
    [recognizedWords, language, customTranslations],
  );

  const emitHandOnlyWord = useCallback((word: string, confidence: number): boolean => {
    const canonicalWord = canonicalLabel(word);
    const isSameHeldWord = lastEmittedHandOnlyWordRef.current === canonicalWord &&
      !handReleasedSinceLastEmitRef.current;
    if (isSameHeldWord) return false;

    lastEmittedHandOnlyWordRef.current = canonicalWord;
    handReleasedSinceLastEmitRef.current = false;
    setRecognizedWordsRef.current(prev => [
      { word, confidence, timestamp: Date.now() },
      ...prev.slice(0, 49),
    ]);
    if (autoSpeakRef.current && audioEnabledRef.current) {
      speak(
        translateGesture(word, languageRef.current, customTranslationsRef.current),
        LANGUAGE_BCP47[languageRef.current] ?? 'en-US',
        onMissingVoiceRef.current,
      );
    }
    return true;
  }, []);

  const onLandmarks = useCallback((
    features: number[],
    rawRight: Landmark[] | null,
    handPresent: boolean,
    isHeld: boolean,
    _rawLeft?: Landmark[] | null,
    _face?: Landmark[] | null,
    _leftHeld?: boolean,
    interaction?: HandFaceInteraction | null,
    candidateInteraction?: HandFaceInteraction | null,
  ) => {
    const faceContact = candidateInteraction ?? interaction ?? null;
    if (!handPresent) {
      handReleasedSinceLastEmitRef.current = true;
    }

    // ── Face-interaction priority gate (synchronous) ─────────────────────────
    if (faceContact) {
      faceActiveRef.current = true;
      faceHoldRef.current = FACE_INTERACTION_HOLD;

      if (interaction && emittedFaceRegionRef.current === null) {
        const combinedLabel = getCombinedGestureLabel(rightLiveGestureRef.current, interaction.faceRegion);
        if (autoSpeakRef.current && audioEnabledRef.current) {
          speak(
            translateGesture(combinedLabel, languageRef.current, customTranslationsRef.current),
            LANGUAGE_BCP47[languageRef.current] ?? 'en-US',
            onMissingVoiceRef.current,
          );
        }
        setRecognizedWordsRef.current(prev => [
          { word: combinedLabel, confidence: 100, timestamp: Date.now() },
          ...prev.slice(0, 49),
        ]);
        emittedFaceRegionRef.current = interaction.faceRegion;
      }
    } else {
      if (faceHoldRef.current > 0) {
        faceHoldRef.current--;
        // faceActiveRef stays true during the hold window
      } else {
        faceActiveRef.current = false;
        emittedFaceRegionRef.current = null;
      }
    }

    const isHybrid = recognizerModeRef.current === 'hybrid' && isCustomModelReady();
    let customFrame: CustomFramePrediction | null = null;

    if (isHybrid) {
      const result = predictCustomModel(features);
      const routerSnapshot = hybridRouterRef.current.getSnapshot();
      const candidate = routerSnapshot.source === 'ONNX_ACTIVE'
        ? null
        : getCustomGestureCandidate(result);
      const liveLabel = candidate?.label ?? null;
      const confidence = candidate?.confidence ?? 0;
      const isCustomLabelSwitch = routerSnapshot.source === 'CUSTOM_ACTIVE' &&
        Boolean(liveLabel) &&
        Boolean(routerSnapshot.activeLabel) &&
        !sameGestureLabel(liveLabel, routerSnapshot.activeLabel);

      if (isCustomLabelSwitch) {
        const pending = pendingCustomSwitchRef.current;
        if (sameGestureLabel(pending.label, liveLabel)) {
          pending.frames += 1;
        } else {
          pending.label = liveLabel;
          pending.frames = 1;
        }
        if (pending.frames >= CUSTOM_LABEL_SWITCH_FRAMES) {
          customFsmRef.current.reset();
          pendingCustomSwitchRef.current = { label: null, frames: 0 };
        }
      } else {
        pendingCustomSwitchRef.current = { label: null, frames: 0 };
      }

      const customStep = customFsmRef.current.step({
        predictedLabel: liveLabel,
        confidenceProb: confidence / 100,
        isBlankLike: !liveLabel || !handPresent || isHeld,
        isLowMotion: false,
      });
      const isCustomCoolingDown = customStep.snapshot.state === 'COOLDOWN';

      customFrame = {
        candidateLabel: liveLabel,
        liveLabel: isCustomCoolingDown && !isCustomLabelSwitch ? null : liveLabel,
        confidence,
        allScores: result?.allScores ?? [],
        fsmState: customStep.snapshot.state,
        stableCount: customStep.snapshot.stableCount,
        cooldownFrames: customStep.snapshot.cooldown,
        blankStableCount: customStep.snapshot.blankStableCount,
        blankStableRequired: customStep.snapshot.blankStableRequired,
        emittedWord: faceActiveRef.current ? null : customStep.emittedWord,
      };
    }

    const dispatchCustomFrame = (frame: CustomFramePrediction, source: HybridSource) => {
      rightLiveGestureRef.current = frame.liveLabel;
      const emittedWord = frame.emittedWord && emitHandOnlyWord(frame.emittedWord, frame.confidence)
        ? frame.emittedWord
        : null;
      dispatch({
        type: 'UPDATE_CUSTOM',
        result: {
          liveLabel: frame.liveLabel,
          liveConfidence: frame.liveLabel ? frame.confidence : 0,
          allScores: frame.allScores,
          fsmState: frame.fsmState,
          stableCount: frame.stableCount,
          cooldownFrames: frame.cooldownFrames,
          blankStableCount: frame.blankStableCount,
          blankStableRequired: frame.blankStableRequired,
          emittedWord,
          source,
        },
      });
    };

    if (!isOnnxModelReady()) {
      if (isHybrid && customFrame) {
        const snapshot = hybridRouterRef.current.step({
          handPresent,
          onnxLabel: null,
          onnxConfidence: 0,
          onnxState: 'IDLE',
          customLabel: customFrame.candidateLabel,
          customConfidence: customFrame.confidence,
          customState: customFrame.fsmState,
        });
        if (snapshot.source === 'CUSTOM_ACTIVE') dispatchCustomFrame(customFrame, snapshot.source);
      }
      return;
    }

    // Primary-hand ONNX pipeline.
    if (!rightBusyRef.current) {
      rightBusyRef.current = true;
      void predictOnnx(features, handPresent, isHeld)
        .then((result) => {
          if (!result) return;
          const mappedResult: SequencePrediction = result;
          const onnxLiveLabel = mappedResult.liveLabel === 'blank' ? null : mappedResult.liveLabel;
          let activeSource: HybridSource = 'ONNX_ACTIVE';
          if (isHybrid) {
            const snapshot = hybridRouterRef.current.step({
              handPresent,
              onnxLabel: onnxLiveLabel,
              onnxConfidence: onnxLiveLabel ? mappedResult.liveConfidence : 0,
              onnxState: mappedResult.state,
              customLabel: customFrame?.candidateLabel ?? null,
              customConfidence: customFrame?.confidence ?? 0,
              customState: customFrame?.fsmState ?? 'IDLE',
            });

            if (snapshot.source === 'CUSTOM_ACTIVE' && customFrame) {
              dispatchCustomFrame(customFrame, snapshot.source);
              return;
            }

            activeSource = snapshot.source;
            if (activeSource !== 'ONNX_ACTIVE') return;

            if (snapshot.source === 'ONNX_ACTIVE') {
              customFsmRef.current.reset();
            }
          }
          rightLiveGestureRef.current = onnxLiveLabel;
          const allowed = mappedResult.emittedWord
            ? shouldEmitGesture(mappedResult.emittedWord, interaction)
            : true;
          const emittedWord = allowed && !faceActiveRef.current && mappedResult.emittedWord &&
            emitHandOnlyWord(mappedResult.emittedWord, mappedResult.liveConfidence)
            ? mappedResult.emittedWord
            : null;
          const guardedResult = { ...mappedResult, emittedWord };
          dispatch({
            type: 'UPDATE_RIGHT',
            result: guardedResult,
            source: activeSource,
          });
        })
        .catch(err => console.error('ONNX inference error:', err))
        .finally(() => { rightBusyRef.current = false; });
    }
  }, [emitHandOnlyWord]); // stable — reads all mutable values via refs

  const { videoRef, canvasRef, state: camState, start, stop } = useMediaPipe({
    onLandmarks,
    showOverlay: true,
  });

  const handleStop = useCallback(() => {
    stop();
    resetOnnxPredictionState();
    resetCustomPredictionState();
    rightBusyRef.current = false;
    rightLiveGestureRef.current = null;
    dispatch({ type: 'RESET' });
  }, [stop, resetCustomPredictionState]);

  const resetRecognitionDisplay = useCallback(() => {
    resetOnnxPredictionState();
    resetCustomPredictionState();
    rightBusyRef.current = false;
    rightLiveGestureRef.current = null;
    dispatch({ type: 'RESET' });
  }, [resetCustomPredictionState]);

  const handleRecognizerModeChange = useCallback(async (mode: RecognizerMode) => {
    if (mode === recognizerMode) return;

    if (mode === 'hybrid') {
      setCustomModelNotice(null);
      if (!isCustomModelReady()) {
        setCustomModelLoading(true);
        const loaded = await loadCustomModel();
        setCustomModelLoading(false);
        setCustomModelReady(loaded);
        if (!loaded) {
          const message = 'Train or load a custom model first.';
          setCustomModelNotice(message);
          toast.error(message);
          setRecognizerMode('onnx');
          recognizerModeRef.current = 'onnx';
          resetRecognitionDisplay();
          return;
        }
      } else {
        setCustomModelReady(true);
      }
    } else {
      setCustomModelNotice(null);
    }

    setRecognizerMode(mode);
    recognizerModeRef.current = mode;
    resetRecognitionDisplay();
  }, [recognizerMode, resetRecognitionDisplay]);

  /** Dismiss the right-hand pending notification (word already auto-appended). */
  const handleConfirmPending = useCallback(() => {
    dispatch({ type: 'CONFIRM_PENDING' });
  }, []);

  const handleSpeak = useCallback(() => {
    if (!accessibility.audioEnabled) return;
    const currentTranslated = pred.currentGesture
      ? translateGesture(pred.currentGesture, accessibility.language, customTranslations)
      : null;
    const text = displaySentence.trim() || currentTranslated;
    if (text) speak(text, LANGUAGE_BCP47[accessibility.language] ?? 'en-US', onMissingVoice);
  }, [accessibility.audioEnabled, accessibility.language, customTranslations, displaySentence, pred.currentGesture, onMissingVoice]);

  useEffect(() => {
    return () => {
      stop();
      resetOnnxPredictionState();
      resetCustomPredictionState();
    };
  }, [stop, resetCustomPredictionState]);

  const confidenceColor = pred.currentConfidence >= 90
    ? 'text-success'
    : pred.currentConfidence >= 75
      ? 'text-warning'
      : 'text-destructive';

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
            Dynamic ASL Gesture Recognition
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detects one-hand gesture bundles ({BUFFER_FRAMES} frames) for: hello, yes, no, please, help, plus face-touch interactions.
          </p>
        </div>

        {/* Top-right: language selector + model error */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <LanguageSelector
            value={language}
            onChange={code => {
              setAccessibility({ language: code });
              if (audioEnabledRef.current && piperHasVoice(code)) {
                void preWarmPiper(code);
              }
            }}
          />
          {modelError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertCircle className="w-4 h-4 text-destructive" />
              <p className="text-xs text-destructive">{modelError}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6 xl:gap-8">
        {/* Left: Camera Feed */}
        <div className="col-span-3 space-y-4">
          <div className="cam-gradient-border bg-card rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
                  Camera Feed
                </span>
                {/* Model source badge */}
                <span className={cn(
                  'ml-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border',
                  recognizerMode === 'hybrid'
                    ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                    : 'bg-primary/10 text-primary border-primary/20',
                )}>
                  {recognizerMode === 'hybrid' ? 'Hybrid TF.js + ONNX' : 'ONNX Dynamic'}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                {camState.isActive && (
                  <>
                    <span>{camState.fps} FPS</span>

                    {/* Right hand indicator */}
                    <div className={cn(
                      'flex items-center gap-1',
                      camState.rawLandmarks ? 'text-primary' : 'text-muted-foreground',
                    )}>
                      <div className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        camState.rawLandmarks ? 'bg-primary animate-pulse' : 'bg-muted-foreground',
                      )} />
                      R
                    </div>

                    {camState.facePresent && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        Face
                      </span>
                    )}

                    {camState.handFaceInteraction && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 animate-pulse">
                        Touch
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="relative bg-black aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                width={640}
                height={480}
                style={{ transform: 'scaleX(-1)' }}
              />

              {pred.currentGesture && camState.isActive && (
                <div className={cn(
                  'absolute bottom-4 left-4 right-4 flex items-center justify-between',
                  'bg-background/80 backdrop-blur-sm rounded-lg px-4 py-2 border',
                  pred.isConfirmed ? 'border-primary/40' : 'border-border',
                )}>
                  <div className="flex items-center gap-2">
                    {pred.isConfirmed
                      ? <CheckCircle className="w-4 h-4 text-primary" />
                      : <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />}
                    <span className="text-sm font-bold text-foreground uppercase" style={{ fontFamily: 'Space Grotesk' }}>
                      {translateGesture(pred.currentGesture, language, customTranslations)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-sm font-mono font-bold', confidenceColor)}>
                      {pred.currentConfidence}%
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      State: {pred.fsmState}
                    </p>
                    {pred.cooldownFrames > 0 && (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        Cooldown: {pred.cooldownFrames}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* No hands detected banner */}
              {camState.isActive && !camState.rawLandmarks && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border text-xs font-mono text-muted-foreground">
                  No hand detected
                </div>
              )}

              {!camState.isActive && !camState.isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90">
                  <img src={HAND_IMG} alt="Hand" className="w-32 h-32 object-contain opacity-30 mb-4" />
                  <p className="text-sm text-muted-foreground">Camera not started</p>
                </div>
              )}

              {camState.isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90">
                  <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-sm text-muted-foreground">Loading MediaPipe...</p>
                </div>
              )}

              {camState.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/90">
                  <AlertCircle className="w-10 h-10 text-destructive mb-2" />
                  <p className="text-sm text-destructive">{camState.error}</p>
                </div>
              )}
            </div>

            <div className="p-4 flex items-center gap-3 flex-wrap">
              {!camState.isActive ? (
                <button
                  onClick={start}
                  disabled={
                    camState.isLoading ||
                    (recognizerMode === 'onnx' && modelLoading) ||
                    (recognizerMode === 'hybrid' && customModelLoading)
                  }
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(recognizerMode === 'onnx' && modelLoading) || (recognizerMode === 'hybrid' && customModelLoading) ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Loading Model...
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      Start Camera
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop
                </button>
              )}

              <button
                onClick={() => setGuideOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Gesture Guide
              </button>

              <div className="flex items-center gap-1 rounded-lg bg-muted border border-border p-1">
                <button
                  onClick={() => void handleRecognizerModeChange('onnx')}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-colors',
                    recognizerMode === 'onnx'
                      ? 'bg-primary/20 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  ONNX
                </button>
                <button
                  onClick={() => void handleRecognizerModeChange('hybrid')}
                  disabled={customModelLoading}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-colors disabled:opacity-50',
                    recognizerMode === 'hybrid'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {customModelLoading ? 'Loading...' : 'Hybrid'}
                </button>
              </div>

              <button
                onClick={() => setAccessibility({ autoSpeak: !accessibility.autoSpeak })}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                  accessibility.autoSpeak
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-muted text-muted-foreground border-border hover:text-foreground',
                )}
              >
                <Volume2 className="w-4 h-4" />
                Auto-Speak {accessibility.autoSpeak ? 'ON' : 'OFF'}
              </button>

              {recognizerMode === 'onnx' && !modelReady && !modelLoading && (
                <p className="text-xs text-warning">
                  Camera can run, but predictions start only when the model is loaded.
                </p>
              )}

              {recognizerMode === 'hybrid' && !customModelReady && !customModelLoading && (
                <p className="text-xs text-warning">
                  Train or load a custom model first.
                </p>
              )}

              {customModelNotice && recognizerMode === 'onnx' && (
                <p className="text-xs text-warning">{customModelNotice}</p>
              )}

              <button
                onClick={handleSpeak}
                disabled={!pred.currentGesture && displaySentence.trim().length === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-foreground border border-border text-sm hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {accessibility.audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Recognition State */}
        <div className="col-span-2 space-y-4">

          {/* ── Live Text Output (≥80% confidence threshold) ───────────────── */}
          <div className="panel-accent bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-mono text-muted-foreground mb-3">LIVE GESTURE OUTPUT</p>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-xs w-24 shrink-0">Primary Hand:</span>
                {camState.rawLandmarks && pred.liveGesture && pred.liveConfidence >= 80 ? (
                  <span className="text-primary font-bold uppercase">
                    {translateGesture(pred.liveGesture, language, customTranslations)}{' '}
                    <span className="font-normal text-xs">({Math.round(pred.liveConfidence)}%)</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {camState.rawLandmarks ? 'none' : 'not detected'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Hand Status (detection + live gesture) ─────────────────────── */}
          <div className="panel-accent bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-mono text-muted-foreground">HAND DETECTION</p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  camState.rawLandmarks ? 'bg-primary animate-pulse' : 'bg-muted',
                )} />
                <span className="text-xs font-mono text-muted-foreground">PRIMARY HAND</span>
              </div>
              <div className="text-right">
                <span className={cn(
                  'text-sm font-bold uppercase',
                  pred.liveGesture ? 'text-primary' : 'text-muted-foreground',
                )} style={{ fontFamily: 'Space Grotesk' }}>
                  {camState.rawLandmarks
                    ? (pred.liveGesture ? translateGesture(pred.liveGesture, language, customTranslations) : '…')
                    : 'Not detected'}
                </span>
                {camState.rawLandmarks && pred.liveConfidence > 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {Math.round(pred.liveConfidence)}%
                  </p>
                )}
              </div>
            </div>

            {!camState.rawLandmarks && camState.isActive && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                Show one hand in front of the camera
              </p>
            )}
          </div>

          {/* ── Combined Gesture (hand-face interaction mode) ──────────────── */}
          {camState.handFaceInteraction && (
            <div className="bg-card border border-yellow-500/30 rounded-xl p-4 space-y-2">
              <p className="text-xs font-mono text-yellow-400">COMBINED GESTURE (HAND-FACE)</p>
              <div className="text-2xl font-bold uppercase text-yellow-400" style={{ fontFamily: 'Space Grotesk' }}>
                {translateGesture(
                  getCombinedGestureLabel(pred.liveGesture, camState.handFaceInteraction.faceRegion),
                  language,
                  customTranslations,
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="bg-muted/50 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground">Input</p>
                  <p className="text-foreground">Primary hand</p>
                </div>
                <div className="bg-muted/50 rounded-lg px-3 py-2">
                  <p className="text-muted-foreground">Face Region</p>
                  <p className="text-foreground">{FACE_REGION_LABEL[camState.handFaceInteraction.faceRegion]}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Detected Gesture ───────────────────────────────────────────── */}
          <div className={cn(
            'panel-accent bg-card border rounded-xl p-4 transition-all duration-300',
            pred.isConfirmed ? 'border-primary/40' : 'border-border',
          )}>
            <p className="text-xs font-mono text-muted-foreground mb-3">DETECTED GESTURES</p>

            <div className="mb-3 pb-3 border-b border-border">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] font-mono text-primary/70 uppercase tracking-wider">Primary</span>
                <span className={cn(
                  'text-3xl font-bold uppercase transition-all duration-200',
                  pred.currentGesture
                    ? pred.isConfirmed ? 'text-primary' : 'text-foreground'
                    : 'text-muted-foreground',
                )} style={{ fontFamily: 'Space Grotesk' }}>
                  {pred.currentGesture ? translateGesture(pred.currentGesture, language, customTranslations) : '—'}
                </span>
              </div>
              {/* Confidence bar */}
              <div>
                <div className="flex justify-between text-[10px] font-mono mb-0.5">
                  <span className="text-muted-foreground">Confidence</span>
                  <span className={confidenceColor}>{pred.currentConfidence}%</span>
                </div>
                <div className="h-3 bg-muted/60 rounded-full overflow-hidden border border-muted/30">
                  <div
                    className="confidence-bar-shine h-full rounded-full transition-all duration-200"
                    style={{
                      width: `${Math.max(0, Math.min(100, pred.currentConfidence))}%`,
                      background: pred.currentConfidence >= 90
                        ? 'linear-gradient(90deg, #059669, #10b981, #34d399)'
                        : pred.currentConfidence >= 75
                          ? 'linear-gradient(90deg, #d97706, #f59e0b, #fcd34d)'
                          : 'linear-gradient(90deg, #dc2626, #ef4444, #ff6b7a)',
                      boxShadow: pred.currentConfidence >= 90
                        ? '0 0 14px rgba(16,185,129,0.85), 0 0 5px rgba(52,211,153,0.5)'
                        : pred.currentConfidence >= 75
                          ? '0 0 14px rgba(245,158,11,0.85), 0 0 5px rgba(252,211,77,0.5)'
                          : '0 0 12px rgba(239,68,68,0.7), 0 0 4px rgba(255,107,122,0.4)',
                    }}
                  />
                </div>
              </div>

              <div className="mt-1.5">
                <div className="flex justify-between text-[10px] font-mono mb-0.5">
                  <span className="text-muted-foreground">Stability</span>
                  <span className="text-foreground">{pred.stableCount}/{CONFIRMATION_FRAMES}</span>
                </div>
                <div className="flex gap-0.5">
                  {Array.from({ length: CONFIRMATION_FRAMES }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex-1 h-1 rounded-full transition-all duration-100',
                        i < pred.stableCount
                          ? pred.isConfirmed ? 'bg-primary' : 'bg-warning'
                          : 'bg-muted',
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Right pending notification */}
              {pred.pendingWord && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] font-mono text-warning">
                    Added:{' '}
                    <span className="font-bold uppercase">
                      {translateGesture(pred.pendingWord, language, customTranslations)}
                    </span>{' '}
                    <span className="opacity-70">({pred.pendingConfidence}%)</span>
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleConfirmPending}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold transition-opacity hover:opacity-90"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Dismiss
                    </button>
                    <button
                      onClick={() => dispatch({ type: 'DISCARD_PENDING' })}
                      className="px-2 py-1.5 rounded-lg bg-muted text-muted-foreground text-[11px] hover:text-foreground border border-border transition-colors"
                      title="Discard"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-2 pt-2 border-t border-border">
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                <div className="bg-muted/50 rounded px-2 py-1">
                  <p className="text-muted-foreground">Buffer</p>
                  <p className="text-foreground">{pred.bufferSize}/{BUFFER_FRAMES}</p>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <p className="text-muted-foreground">FSM</p>
                  <p className="text-foreground">{pred.fsmState}</p>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <p className="text-muted-foreground">Cooldown</p>
                  <p className="text-foreground">{pred.cooldownFrames}</p>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <p className="text-muted-foreground">Blank Rearm</p>
                  <p className="text-foreground">{pred.blankStableCount}/{pred.blankStableRequired}</p>
                </div>
                <div className="bg-muted/50 rounded px-2 py-1">
                  <p className="text-muted-foreground">Source</p>
                  <p className="text-foreground">{formatHybridSource(pred.hybridSource)}</p>
                </div>
              </div>
              <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                live: {pred.liveGesture ?? 'blank'} · source: {formatHybridSource(pred.hybridSource)} · motion: {pred.motionEnergy.toFixed(4)}
              </div>
            </div>
          </div>

          <div className="panel-accent bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono text-muted-foreground">TOP PREDICTIONS</p>
            </div>
            <div className="space-y-1.5">
              {pred.topPredictions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No predictions yet
                </p>
              ) : (
                pred.topPredictions.map((item, i) => (
                  <div
                    key={item.label}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 rounded-lg',
                      i === 0 ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50',
                    )}
                  >
                    <span className={cn(
                      'text-sm font-bold uppercase',
                      i === 0 ? 'text-primary' : 'text-foreground',
                    )}>
                      {translateGesture(item.label, language, customTranslations)}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {item.score}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel-accent bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono text-muted-foreground">SENTENCE OUTPUT</p>
              <button
                onClick={() => setRecognizedWords([])}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="min-h-[72px] rounded-lg bg-muted/40 border border-border px-3 py-2">
              {displaySentence.trim().length > 0 ? (
                <p className="text-sm text-foreground leading-relaxed">{displaySentence}</p>
              ) : (
                <p className="text-xs text-muted-foreground py-2">
                  Recognized gestures and face-touch interactions are added here automatically.
                </p>
              )}
            </div>

            <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
              {recognizedWords.map((item, i) => (
                <div
                  key={item.timestamp}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-lg',
                    i === 0 ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50',
                  )}
                >
                  <span className={cn(
                    'text-sm font-bold uppercase',
                    i === 0 ? 'text-primary' : 'text-foreground',
                  )}>
                    {translateGesture(item.word, language, customTranslations)}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">
                    {item.confidence}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {guideOpen && (
        <GestureGuide language={language} onClose={() => setGuideOpen(false)} />
      )}
    </div>
  );
}
