/**
 * DatasetPage.tsx — Dataset Management Interface
 * Features:
 * - Record gesture samples from webcam with MediaPipe
 * - View sample counts per class
 * - Export/Import JSON datasets
 * - Delete individual classes or clear all
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Download, Upload, Trash2, Plus, CheckCircle, AlertCircle, StopCircle } from 'lucide-react';
import { useApp, DEFAULT_GESTURES } from '../contexts/AppContext';
import { useMediaPipe } from '../hooks/useMediaPipe';
import { downloadDataset, parseImportedDataset, getSampleCounts, generateDemoDataset } from '../dataset/datasetUtils';
import type { Landmark } from '../utils/landmarks';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const MIN_SAMPLES_PER_CLASS = 20;
const CAPTURE_INTERVAL_MS = 200; // Capture one sample every 200ms when recording

export default function DatasetPage() {
  const { dataset, addSample, removeLabel, clearDataset, importDataset, mergeDataset } = useApp();
  const [selectedGesture, setSelectedGesture] = useState(DEFAULT_GESTURES[0]);
  const [customGesture, setCustomGesture] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const captureCountRef = useRef(0);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestFeaturesRef = useRef<number[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<'replace' | 'merge'>('replace');

  const onLandmarks = useCallback((features: number[], _raw: Landmark[] | null, handPresent: boolean, _isHeld: boolean, _rawLeft?: Landmark[] | null, _face?: Landmark[] | null) => {
    // Store features whenever ANY hand is present (right or left)
    const anyHandPresent = handPresent || (_rawLeft != null);
    latestFeaturesRef.current = anyHandPresent ? features : null;
  }, []);

  const { videoRef, canvasRef, state: camState, start, stop } = useMediaPipe({
    onLandmarks,
    showOverlay: true,
  });

  const sampleCounts = getSampleCounts(dataset);

  // All available gestures (default + any custom ones in dataset)
  const allGestures = Array.from(new Set([
    ...DEFAULT_GESTURES,
    ...dataset.labels.filter(l => !DEFAULT_GESTURES.includes(l)),
  ]));

  const startRecording = useCallback(() => {
    if (!camState.isActive) {
      toast.error('Please start the camera first');
      return;
    }
    setIsRecording(true);
    setCaptureCount(0);
    captureCountRef.current = 0;

    captureIntervalRef.current = setInterval(() => {
      const features = latestFeaturesRef.current;
      if (features) {
        addSample({
          label: selectedGesture,
          landmarks: features,
          timestamp: Date.now(),
        });
        captureCountRef.current += 1;
        setCaptureCount(captureCountRef.current);
      }
    }, CAPTURE_INTERVAL_MS);
  }, [camState.isActive, selectedGesture, addSample]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    toast.success(`Recorded ${captureCountRef.current} samples for "${selectedGesture}"`);
  }, [selectedGesture]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    };
  }, []);

  const handleExport = () => {
    if (dataset.samples.length === 0) {
      toast.error('No samples to export');
      return;
    }
    downloadDataset(dataset.samples);
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
    try {
      const text = await file.text();
      const samples = parseImportedDataset(text);
      if (importModeRef.current === 'merge') {
        mergeDataset(samples);
        toast.success(`Added ${describeSamples(samples)}`);
      } else {
        importDataset(samples);
        toast.success(`Imported ${describeSamples(samples)}`);
      }
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : 'Invalid file'}`);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLoadStarterDataset = () => {
    const samples = generateDemoDataset(DEFAULT_GESTURES, 30);
    if (samples.length === 0) {
      toast.error('Starter dataset could not be generated');
      return;
    }
    mergeDataset(samples);
    toast.success(`Added ${describeSamples(samples)}`);
  };

  const handleClear = () => {
    if (confirm('Clear all dataset samples? This cannot be undone.')) {
      clearDataset();
      toast.info('Dataset cleared');
    }
  };

  const handleAddCustom = () => {
    const name = customGesture.trim();
    if (!name) return;
    if (allGestures.includes(name)) {
      toast.error('Gesture already exists');
      return;
    }
    setSelectedGesture(name);
    setCustomGesture('');
    toast.success(`Added gesture: ${name}`);
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
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* ── Left: Camera + Recording ─────────────────────────────── */}
        <div className="col-span-3 space-y-4">
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
                {camState.facePresent && (
                  <span className="text-purple-400">Face</span>
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
            <div className="p-4 flex items-center gap-3">
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
                  onClick={stop}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Stop Camera
                </button>
              )}

              {!isRecording ? (
                <button
                  onClick={startRecording}
                  disabled={!camState.isActive || (!camState.rawLandmarks && !camState.leftRawLandmarks)}
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
                  onClick={() => setSelectedGesture(gesture)}
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
            <div className="flex gap-2">
              <input
                type="text"
                value={customGesture}
                onChange={e => setCustomGesture(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                placeholder="Add custom gesture..."
                className="flex-1 px-3 py-1.5 rounded-lg bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
              <button
                onClick={handleAddCustom}
                className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary border border-primary/30 text-sm hover:bg-primary/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Dataset Stats ─────────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          {/* Summary */}
          <div className="bg-card border border-border rounded-xl p-4">
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
                                removeLabel(label);
                                toast.info(`Removed "${label}" from dataset`);
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80"
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
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
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
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20 text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Load Starter Dataset
            </button>
            <button
              onClick={() => openImport('merge')}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-foreground border border-border text-sm font-medium hover:bg-accent transition-colors"
            >
              <Upload className="w-4 h-4" />
              Add Dataset to Current
            </button>
            <button
              onClick={() => openImport('replace')}
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
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg bg-destructive/10 text-destructive border border-destructive/20 text-sm font-medium hover:bg-destructive/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Data
            </button>
          </div>

          {/* Recording tips */}
          <div className="bg-muted/30 border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              Recording Tips
            </h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
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
    </div>
  );
}
