/**
 * DatasetPage.tsx — Dataset Management Interface
 * Features:
 * - Record gesture samples from webcam with MediaPipe
 * - View sample counts per class
 * - Export/Import JSON datasets
 * - Delete individual classes or clear all
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Camera, Download, Upload, Trash2, Plus, CheckCircle, AlertCircle, StopCircle } from 'lucide-react';
import { useApp, DEFAULT_GESTURES } from '../contexts/AppContext';
import { useMediaPipe } from '../hooks/useMediaPipe';
import {
  downloadDataset,
  parseImportedDatasetBundle,
  getSampleCounts,
  generateDemoDataset,
  isFaceInteractiveGesture,
} from '../dataset/datasetUtils';
import { LANGUAGES, normalizeGestureLabel } from '../i18n/translations';
import type { Landmark } from '../utils/landmarks';
import { toHandOnlyFeatures } from '../utils/landmarks';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ImportOwnership } from '../dataset/importOwnership';

const MIN_SAMPLES_PER_CLASS = 20;
const CAPTURE_INTERVAL_MS = 200; // Capture one sample every 200ms when recording
const TRAINABLE_DEFAULT_GESTURES = DEFAULT_GESTURES.filter(gesture => !isFaceInteractiveGesture(gesture));

export default function DatasetPage() {
  const {
    accessibility,
    dataset,
    customTranslations,
    addSample,
    removeLabel,
    clearDataset,
    mergeDataset,
    replaceDatasetBundle,
    mergeDatasetBundle,
    setCustomTranslation,
    datasetStorageStatus,
    datasetStorageError,
    flushDatasetStorage,
  } = useApp();
  const [selectedGesture, setSelectedGesture] = useState(TRAINABLE_DEFAULT_GESTURES[0] ?? DEFAULT_GESTURES[0]);
  const [customGesture, setCustomGesture] = useState('');
  const [customGestureTranslation, setCustomGestureTranslation] = useState('');
  const [customGestureLabels, setCustomGestureLabels] = useState<string[]>([]);
  const [selectedTranslation, setSelectedTranslation] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const captureCountRef = useRef(0);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestFeaturesRef = useRef<{ features: number[]; frame: number; seenAt: number } | null>(null);
  const latestFrameRef = useRef(0);
  const lastCapturedFrameRef = useRef(0);
  const recordingLabelRef = useRef<string | null>(null);
  const endingRecordingRef = useRef<Promise<void> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<'replace' | 'merge'>('replace');
  const importOwnerRef = useRef(new ImportOwnership());
  const invalidatePendingImport = useCallback(() => {
    importOwnerRef.current.invalidate();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const onLandmarks = useCallback((features: number[], _raw: Landmark[] | null, handPresent: boolean, _isHeld: boolean, _rawLeft?: Landmark[] | null, _face?: Landmark[] | null) => {
    // Store features whenever ANY hand is present (right or left)
    const anyHandPresent = handPresent || (_rawLeft != null);
    latestFeaturesRef.current = anyHandPresent
      ? { features: toHandOnlyFeatures(features), frame: ++latestFrameRef.current, seenAt: Date.now() }
      : null;
  }, []);

  const { videoRef, canvasRef, state: camState, start, stop } = useMediaPipe({
    onLandmarks,
    showOverlay: true,
    enableFaceTracking: false,
  });

  const sampleCounts = getSampleCounts(dataset);
  const currentLanguage = accessibility.language;
  const currentLanguageName = LANGUAGES.find(lang => lang.code === currentLanguage)?.nativeName ?? currentLanguage;
  const selectedGestureKey = normalizeGestureLabel(selectedGesture);
  const isSelectedDefaultGesture = DEFAULT_GESTURES.some(
    gesture => normalizeGestureLabel(gesture) === selectedGestureKey,
  );

  // All available gestures (default + any custom ones in dataset)
  const allGestures = useMemo(() => Array.from(new Set([
    ...TRAINABLE_DEFAULT_GESTURES,
    ...customGestureLabels,
    ...dataset.labels.filter(l => !DEFAULT_GESTURES.includes(l) && !isFaceInteractiveGesture(l)),
  ])), [customGestureLabels, dataset.labels]);

  const canMutateDataset = datasetStorageStatus !== 'loading' && datasetStorageStatus !== 'error';

  const endRecording = useCallback((announce = true): Promise<void> => {
    if (endingRecordingRef.current) return endingRecordingRef.current;

    const wasRecording = captureIntervalRef.current !== null;
    const label = recordingLabelRef.current ?? selectedGesture;
    const count = captureCountRef.current;
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    captureIntervalRef.current = null;
    latestFeaturesRef.current = null;
    recordingLabelRef.current = null;
    setIsRecording(false);

    const ending = (async () => {
      if (!wasRecording) return;
      const saved = await flushDatasetStorage();
      if (!announce) return;
      if (saved) {
        toast.success(`Recorded ${count} samples for "${label}" and saved them`);
      } else {
        toast.error(`Recorded ${count} samples for "${label}", but browser storage could not save them`);
      }
    })();
    endingRecordingRef.current = ending;
    void ending.finally(() => {
      if (endingRecordingRef.current === ending) endingRecordingRef.current = null;
    });
    return ending;
  }, [flushDatasetStorage, selectedGesture]);

  const startRecording = useCallback(() => {
    if (!camState.isActive || !canMutateDataset) {
      toast.error('Please start the camera first');
      return;
    }
    invalidatePendingImport();
    setIsRecording(true);
    setCaptureCount(0);
    captureCountRef.current = 0;
    recordingLabelRef.current = selectedGesture;
    latestFeaturesRef.current = null;
    lastCapturedFrameRef.current = 0;

    captureIntervalRef.current = setInterval(() => {
      const frame = latestFeaturesRef.current;
      if (
        frame
        && frame.frame > lastCapturedFrameRef.current
        && Date.now() - frame.seenAt <= CAPTURE_INTERVAL_MS * 2
        && recordingLabelRef.current
      ) {
        addSample({
          label: recordingLabelRef.current,
          landmarks: frame.features,
          timestamp: Date.now(),
        });
        lastCapturedFrameRef.current = frame.frame;
        captureCountRef.current += 1;
        setCaptureCount(captureCountRef.current);
      }
    }, CAPTURE_INTERVAL_MS);
  }, [camState.isActive, canMutateDataset, selectedGesture, addSample, invalidatePendingImport]);

  const stopRecording = useCallback(() => {
    void endRecording();
  }, [endRecording]);

  const handleStopCamera = useCallback(() => {
    void endRecording();
    stop();
  }, [endRecording, stop]);

  const selectGesture = useCallback((gesture: string) => {
    void endRecording(false);
    setSelectedGesture(gesture);
  }, [endRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      invalidatePendingImport();
      void endRecording(false);
    };
  }, [endRecording, invalidatePendingImport]);

  const handleExport = () => {
    if (dataset.samples.length === 0) {
      toast.error('No samples to export');
      return;
    }
    downloadDataset(dataset.samples, 'sign-language-dataset.json', customTranslations);
    toast.success(`Exported ${dataset.samples.length} samples`);
  };

  const describeSamples = (samples: { label: string }[]) => {
    const classCount = new Set(samples.map(sample => sample.label)).size;
    return `${samples.length} samples across ${classCount} ${classCount === 1 ? 'class' : 'classes'}`;
  };

  const openImport = (mode: 'replace' | 'merge') => {
    importModeRef.current = mode;
    fileInputRef.current?.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mode = importModeRef.current;
    const requestId = importOwnerRef.current.begin();
    try {
      const text = await file.text();
      if (!importOwnerRef.current.owns(requestId)) return;
      const parsed = parseImportedDatasetBundle(text);
      const samples = parsed.samples.filter(sample => !isFaceInteractiveGesture(sample.label));
      const skippedFaceSamples = parsed.samples.length - samples.length;
      if (samples.length === 0) {
        toast.error(skippedFaceSamples > 0
          ? `No trainable hand-only samples found; skipped ${skippedFaceSamples} face-touch samples`
          : 'No samples found in dataset');
        return;
      }
      if (!importOwnerRef.current.owns(requestId)) return;
      void endRecording(false);
      if (mode === 'merge') {
        mergeDatasetBundle(samples, parsed.customTranslations);
        toast.success(`Added ${describeSamples(samples)}${parsed.convertedToHandOnlyCount > 0 ? `; converted ${parsed.convertedToHandOnlyCount} old samples to hand-only` : ''}${skippedFaceSamples > 0 ? `; skipped ${skippedFaceSamples} face-touch samples` : ''}`);
      } else {
        replaceDatasetBundle(samples, parsed.customTranslations);
        setCustomGestureLabels([]);
        toast.success(`Imported ${describeSamples(samples)}${parsed.convertedToHandOnlyCount > 0 ? `; converted ${parsed.convertedToHandOnlyCount} old samples to hand-only` : ''}${skippedFaceSamples > 0 ? `; skipped ${skippedFaceSamples} face-touch samples` : ''}`);
      }
    } catch (err) {
      if (importOwnerRef.current.owns(requestId)) {
        toast.error(`Import failed: ${err instanceof Error ? err.message : 'Invalid file'}`);
      }
    } finally {
      if (importOwnerRef.current.owns(requestId) && fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadStarterDataset = () => {
    invalidatePendingImport();
    const samples = generateDemoDataset(TRAINABLE_DEFAULT_GESTURES, 30);
    if (samples.length === 0) {
      toast.error('Starter dataset could not be generated');
      return;
    }
    void endRecording(false);
    mergeDataset(samples);
    toast.success(`Added ${describeSamples(samples)}`);
  };

  const handleClear = () => {
    if (confirm('Clear all dataset samples? This cannot be undone.')) {
      invalidatePendingImport();
      void endRecording(false);
      clearDataset();
      setCustomGestureLabels([]);
      toast.info('Dataset cleared');
    }
  };

  const handleAddCustom = () => {
    const name = customGesture.trim();
    if (!name) return;
    if (isFaceInteractiveGesture(name)) {
      toast.error('Face-touch gestures are handled in Recognize and are not trained here');
      return;
    }
    if (allGestures.includes(name)) {
      toast.error('Gesture already exists');
      return;
    }
    invalidatePendingImport();
    if (customGestureTranslation.trim()) {
      setCustomTranslation(name, currentLanguage, customGestureTranslation);
    }
    setCustomGestureLabels(prev => prev.includes(name) ? prev : [...prev, name]);
    selectGesture(name);
    setCustomGesture('');
    setCustomGestureTranslation('');
    toast.success(`Added gesture: ${name}`);
  };

  useEffect(() => {
    setSelectedTranslation(customTranslations[selectedGestureKey]?.[currentLanguage] ?? '');
  }, [customTranslations, currentLanguage, selectedGestureKey]);

  useEffect(() => {
    if (allGestures.length > 0 && !allGestures.includes(selectedGesture)) {
      selectGesture(allGestures[0]);
    }
  }, [allGestures, selectedGesture, selectGesture]);

  const handleSelectedTranslationChange = (value: string) => {
    invalidatePendingImport();
    setSelectedTranslation(value);
    setCustomTranslation(selectedGesture, currentLanguage, value);
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Space Grotesk' }}>
          Dataset Manager
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Record gesture samples from your webcam to build a training dataset.
        </p>
        <p className={cn(
          'text-xs mt-2',
          datasetStorageStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}>
          {datasetStorageStatus === 'loading' && 'Loading saved dataset…'}
          {datasetStorageStatus === 'saving' && 'Saving dataset locally…'}
          {datasetStorageStatus === 'saved' && 'Dataset saved locally'}
          {datasetStorageStatus === 'error' && `Dataset storage needs recovery: ${datasetStorageError ?? 'unknown error'}. Import a replacement or clear data to continue.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* ── Left: Camera + Recording ─────────────────────────────── */}
        <div className="min-w-0 space-y-4 xl:col-span-3 xl:row-start-1">
          {/* Camera panel */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold" style={{ fontFamily: 'Space Grotesk' }}>
                  Webcam Feed
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                {camState.isActive && (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    <span>{camState.fps} FPS</span>
                  </>
                )}
                {camState.rawLandmarks && (
                  <span className="text-primary">Hand Detected</span>
                )}
                {camState.leftRawLandmarks && (
                  <span className="text-orange-400">Left Hand</span>
                )}
              </div>
            </div>

            {/* Video container */}
            <div className="relative bg-black aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
                style={{ transform: 'scaleX(-1)' }} // Mirror for natural feel
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                width={640}
                height={480}
                style={{ transform: 'scaleX(-1)' }}
              />

              {/* Recording indicator */}
              {isRecording && (
                <div className="absolute top-3 right-3 flex items-center gap-2 bg-destructive/90 text-white px-3 py-1.5 rounded-full text-xs font-mono pulse-ring">
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  REC · {captureCount} samples
                </div>
              )}

              {/* Camera off state */}
              {!camState.isActive && !camState.isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80">
                  <Camera className="w-12 h-12 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">Camera not started</p>
                  <p className="text-xs text-muted-foreground mt-1">Click "Start Camera" below</p>
                </div>
              )}

              {/* Loading state */}
              {camState.isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-sm text-muted-foreground">Loading MediaPipe...</p>
                </div>
              )}

              {/* Error state */}
              {camState.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80">
                  <AlertCircle className="w-10 h-10 text-destructive mb-2" />
                  <p className="text-sm text-destructive font-medium">Camera Error</p>
                  <p className="text-xs text-muted-foreground mt-1 text-center max-w-xs px-4">{camState.error}</p>
                </div>
              )}
            </div>

            {/* Camera controls */}
            <div className="p-4 flex flex-wrap items-center gap-3">
              {!camState.isActive ? (
                <button
                  onClick={start}
                  disabled={camState.isLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  {camState.isLoading ? 'Loading...' : 'Start Camera'}
                </button>
              ) : (
                <button
                  onClick={handleStopCamera}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop Camera
                </button>
              )}

              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={!canMutateDataset || !camState.isActive || (!camState.rawLandmarks && !camState.leftRawLandmarks)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    camState.isActive && (camState.rawLandmarks || camState.leftRawLandmarks)
                      ? "bg-destructive text-destructive-foreground hover:opacity-90 pulse-ring"
                      : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                  )}
                >
                  <div className="w-3 h-3 rounded-full bg-current" />
                  Record Gesture
                </button>
              ) : (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/20 text-destructive border border-destructive/40 text-sm font-medium hover:bg-destructive/30 transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop Recording
                </button>
              )}

              {!camState.rawLandmarks && !camState.leftRawLandmarks && camState.isActive && (
                <p className="text-xs text-muted-foreground">Show your hand in the camera</p>
              )}
            </div>
          </div>

          {/* Gesture selector */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Space Grotesk' }}>
              Recording Target: <span className="text-primary">{selectedGesture}</span>
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {allGestures.map(gesture => (
                <button
                  key={gesture}
                  onClick={() => selectGesture(gesture)}
                  disabled={!canMutateDataset}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                    selectedGesture === gesture
                      ? "bg-primary/20 text-primary border-primary/40 glow-cyan"
                      : "bg-muted text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {gesture}
                  {sampleCounts[gesture] > 0 && (
                    <span className="ml-1.5 opacity-60">({sampleCounts[gesture]})</span>
                  )}
                </button>
              ))}
            </div>
            {/* Add custom gesture */}
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={customGesture}
                  onChange={e => setCustomGesture(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                  disabled={!canMutateDataset}
                  placeholder="Add custom gesture..."
                  className="min-w-0 flex-1 px-3 py-1.5 rounded-lg bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                />
                <button
                  onClick={handleAddCustom}
                  disabled={!canMutateDataset}
                  aria-label="Add custom gesture"
                  className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary border border-primary/30 text-sm hover:bg-primary/30 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                value={customGestureTranslation}
                onChange={e => setCustomGestureTranslation(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                disabled={!canMutateDataset}
                placeholder={`Optional ${currentLanguageName} translation for new gesture...`}
                className="w-full px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
              {!isSelectedDefaultGesture && (
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">
                    {currentLanguageName} translation for "{selectedGesture}"
                  </label>
                  <input
                    type="text"
                    value={selectedTranslation}
                    onChange={e => handleSelectedTranslationChange(e.target.value)}
                    disabled={!canMutateDataset}
                    placeholder="Leave empty to show the raw label"
                    className="w-full px-3 py-1.5 rounded-lg bg-muted/60 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Dataset Stats ─────────────────────────────────── */}
        <div className="min-w-0 space-y-4 xl:col-span-2 xl:row-start-1 xl:flex xl:h-full xl:flex-col">
          {/* Summary */}
          <div className="bg-card border border-border rounded-xl p-4 xl:flex-1">
            <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Space Grotesk' }}>
              Dataset Summary
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold font-mono text-foreground">{dataset.samples.length}</p>
                <p className="text-[10px] text-muted-foreground">Total Samples</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold font-mono text-foreground">{dataset.labels.length}</p>
                <p className="text-[10px] text-muted-foreground">Classes</p>
              </div>
            </div>

            {/* Per-class breakdown */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {dataset.labels.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No samples recorded yet
                </p>
              ) : (
                dataset.labels.map(label => {
                  const count = sampleCounts[label] || 0;
                  const pct = Math.min((count / MIN_SAMPLES_PER_CLASS) * 100, 100);
                  const isReady = count >= MIN_SAMPLES_PER_CLASS;
                  return (
                    <div key={label} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {isReady
                            ? <CheckCircle className="w-3 h-3 text-success" />
                            : <AlertCircle className="w-3 h-3 text-warning" />
                          }
                          <span className="text-xs font-medium text-foreground">{label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">{count}</span>
                          <button
                            onClick={() => {
                              if (confirm(`Delete all samples for "${label}"?`)) {
                                invalidatePendingImport();
                                void endRecording(false);
                                removeLabel(label);
                                setCustomGestureLabels(prev => prev.filter(customLabel => customLabel !== label));
                                toast.info(`Removed "${label}" from dataset`);
                              }
                            }}
                            disabled={!canMutateDataset}
                            aria-label={`Delete all samples for ${label}`}
                            className="text-destructive transition-opacity hover:text-destructive/80 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300 confidence-bar",
                            isReady ? "bg-success" : "bg-warning"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {!isReady && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Need {MIN_SAMPLES_PER_CLASS - count} more
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Import/Export controls */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-2 xl:flex-1">
            <h3 className="text-sm font-semibold mb-3" style={{ fontFamily: 'Space Grotesk' }}>
              Data Operations
            </h3>
            <button
              onClick={handleExport}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Dataset (JSON)
            </button>
            <button
              onClick={handleLoadStarterDataset}
              disabled={!canMutateDataset}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Load Starter Dataset
            </button>
            <button
              onClick={() => openImport('merge')}
              disabled={!canMutateDataset}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-foreground border border-border text-sm font-medium hover:bg-accent transition-colors"
            >
              <Upload className="w-4 h-4" />
              Add Dataset to Current
            </button>
            <button
              onClick={() => openImport('replace')}
              disabled={datasetStorageStatus === 'loading'}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-foreground border border-border text-sm font-medium hover:bg-accent transition-colors"
            >
              <Upload className="w-4 h-4" />
              Import Dataset (Replace)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={handleClear}
              disabled={datasetStorageStatus === 'loading'}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 text-sm font-medium hover:bg-destructive/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Data
            </button>
          </div>

        </div>

        {/* Recording tips */}
        <div className="w-full bg-muted/30 border border-border rounded-xl p-4 xl:col-span-5 xl:row-start-2">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Recording Tips
          </h3>
          <ul className="grid gap-1.5 text-xs text-muted-foreground md:grid-cols-2">
            <li>• Aim for {MIN_SAMPLES_PER_CLASS}+ samples per gesture</li>
            <li>• Vary hand position and angle slightly</li>
            <li>• Ensure good lighting on your hand</li>
            <li>• Keep background uncluttered</li>
            <li>• Hold gesture steady during capture</li>
            <li>• Load the starter dataset before adding custom gesture samples</li>
            <li>• Add Dataset to Current appends JSON samples without replacing existing data</li>
            <li>• Demo training is scoped to one-hand core gestures</li>
            <li>• Face-touch interactions are handled by the live heuristic, not custom training</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
