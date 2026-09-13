/**
 * useMediaPipe.ts — React hook for MediaPipe Hands + FaceMesh integration
 *
 * Detects one primary hand and the face simultaneously.
 * Produces a 156-dim extended feature vector per frame:
 *   [0:63]    primary hand (wrist-relative normalized)
 *   [63:126]  reserved second-hand slot (zeros in the demo build)
 *   [126:156] 10 key face landmarks (nose-relative normalized, zeros if absent)
 *
 * The ONNX demo model uses the first 63 values. Face landmarks stay available
 * for the fingertip-to-face-region heuristic.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Landmark } from '../utils/landmarks';
import {
  normalizeLandmarks,
  normalizeFaceLandmarks,
  buildExtendedFeatures,
  drawMultiLandmarks,
  FEATURE_DIM_EXTENDED,
} from '../utils/landmarks';

const HOLD_MISSING_FRAMES = 5;
const ZERO_FEATURES = Array(FEATURE_DIM_EXTENDED).fill(0);
const MAX_CONSECUTIVE_ERRORS = 5;

// ── Hand-Face Proximity Detection ────────────────────────────────────────────
// Raised slightly from 0.05 -> 0.065 to improve detection for smaller face
// regions (eye upper-lid, brow area) that were previously missed at the tight
// 0.05 threshold.
const TOUCH_THRESHOLD = 0.065;
const FACE_TOUCH_CONFIRM_FRAMES = 4;
const FINGERTIP_INDICES = [8, 12] as const;

// Raw face landmark indices (full 468-point mesh) grouped by anatomical region.
//
// Region  → gesture meaning in RecognizePage
//   mouth    → Eat / Speak
//   eye      → See / Look
//   nose     → Smell
//   forehead → Think
//   ear      → Listen  (NEW — temple/ear landmarks, hand cupped at ear)
//
// Landmark changes from original:
//   eye      — switched from inner canthi (33/263, near nose) to upper eyelid
//              center (159/386) + outer corners (130/359) for better reach.
//   forehead — switched from top-of-head (10/151) to accessible brow zone
//              (54/284 inner-brow, 21/251 lateral frontal) where "Think" and
//              "Know" naturally occur.
//   ear      — NEW: temple (127/356) + ear-canal area (177/401).
const FACE_PROXIMITY_REGIONS = {
  mouth:    [61, 291, 13, 14] as const,
  eye:      [159, 386, 130, 359] as const,
  nose:     [1, 168, 2, 4] as const,
  forehead: [54, 284, 21, 251] as const,
  ear:      [127, 356, 177, 401] as const,
} as const;

export type FaceRegion = keyof typeof FACE_PROXIMITY_REGIONS;

export interface HandFaceInteraction {
  /** Always true when the object is non-null. */
  touched: boolean;
  /** Which hand is near the face. */
  hand: 'left' | 'right';
  /** Which facial region the fingertip is closest to. */
  faceRegion: FaceRegion;
  /** Euclidean distance (0–1 normalised image-space). */
  distance: number;
}

/**
 * Check whether the index or middle fingertip is within TOUCH_THRESHOLD of any
 * face key-region landmark. Returns the closest interaction, or null.
 */
function checkHandFaceInteraction(
  rightRaw: Landmark[] | null,
  leftRaw: Landmark[] | null,
  faceRaw: Landmark[] | null,
): HandFaceInteraction | null {
  if (!faceRaw || faceRaw.length < 468) return null;

  const candidates: { lm: Landmark[]; side: 'left' | 'right' }[] = [];
  if (rightRaw) candidates.push({ lm: rightRaw, side: 'right' });
  if (leftRaw)  candidates.push({ lm: leftRaw,  side: 'left'  });
  if (candidates.length === 0) return null;

  let best: HandFaceInteraction | null = null;
  let bestDist = Infinity;

  for (const { lm, side } of candidates) {
    for (const tipIdx of FINGERTIP_INDICES) {
      const tip = lm[tipIdx];
      if (!tip) continue;

      for (const [region, indices] of Object.entries(FACE_PROXIMITY_REGIONS) as [FaceRegion, readonly number[]][]) {
        for (const faceIdx of indices) {
          const fp = faceRaw[faceIdx];
          if (!fp) continue;
          const dx = tip.x - fp.x;
          const dy = tip.y - fp.y;
          // z has much smaller range in image-space; downweight it
          const dz = (tip.z - fp.z) * 0.3;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < TOUCH_THRESHOLD && dist < bestDist) {
            bestDist = dist;
            best = { touched: true, hand: side, faceRegion: region, distance: dist };
          }
        }
      }
    }
  }

  return best;
}

export interface MediaPipeState {
  isLoading: boolean;
  isActive: boolean;
  error: string | null;
  fps: number;
  /** Right-hand raw landmarks (image-space 0–1), null if absent. */
  rawLandmarks: Landmark[] | null;
  /** Reserved second-hand state; always null in the demo build. */
  leftRawLandmarks: Landmark[] | null;
  /** Full 468-point face landmarks, null if absent. */
  faceLandmarks: Landmark[] | null;
  /** 156-dim extended feature vector [right|left|face]. */
  normalizedFeatures: number[] | null;
  /** Reserved second-hand state; always false in the demo build. */
  bothHandsPresent: boolean;
  /** True when face mesh is currently detected. */
  facePresent: boolean;
  /** Non-null when face contact passes the 4-frame same-region confirmation gate. */
  handFaceInteraction: HandFaceInteraction | null;
}

export interface UseMediaPipeOptions {
  /**
   * Called each frame with the latest extended features.
   * @param features        156-dim vector [primary hand(63)|zeros(63)|face(30)]
   * @param rawRight        Primary-hand raw landmarks (or null)
   * @param handPresent     Whether a primary hand is detected
   * @param isHeld          Whether features are held from recent past frame
   * @param rawLeft         Reserved second-hand landmarks (always null in demo)
   * @param faceLandmarks   Full 468 face landmarks (or null)
   */
  onLandmarks?: (
    features: number[],
    rawRight: Landmark[] | null,
    handPresent: boolean,
    isHeld: boolean,
    rawLeft?: Landmark[] | null,
    faceLandmarks?: Landmark[] | null,
    leftHeld?: boolean,
    /** Confirmed hand-face interaction after the 4-frame same-region gate. */
    handFaceInteraction?: HandFaceInteraction | null,
    /** Raw same-frame candidate used to suppress hand-only model output while confirming. */
    handFaceCandidate?: HandFaceInteraction | null,
  ) => void;
  showOverlay?: boolean;
  enableFaceTracking?: boolean;
}

interface HandResult {
  right: Landmark[] | null;
  left: Landmark[] | null;
}

interface MediaPipeModel {
  send(options: { image: HTMLVideoElement }): Promise<void>;
  close?: () => Promise<void>;
}

interface MediaPipeSession {
  id: number;
  stopped: boolean;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  hands: MediaPipeModel | null;
  face: MediaPipeModel | null;
  pendingSend: Promise<void> | null;
  raf: number;
}

export function useMediaPipe(options: UseMediaPipeOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<MediaPipeSession | null>(null);
  const sessionIdRef = useRef(0);
  const fpsCounterRef = useRef({ frames: 0, lastTime: performance.now() });
  const mountedRef = useRef(true);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const faceInteractionConfirmRef = useRef<{ region: FaceRegion | null; frames: number }>({
    region: null,
    frames: 0,
  });

  // Per-hand hold tracking
  const lastRightFeaturesRef = useRef<number[] | null>(null);
  const lastLeftFeaturesRef = useRef<number[] | null>(null);
  const rightMissingRef = useRef(0);
  const leftMissingRef = useRef(0);

  // Intermediate results (written by onResults callbacks, read in processFrame)
  const handResultRef = useRef<HandResult>({ right: null, left: null });
  const faceResultRef = useRef<Landmark[] | null>(null);

  const [state, setState] = useState<MediaPipeState>({
    isLoading: false,
    isActive: false,
    error: null,
    fps: 0,
    rawLandmarks: null,
    leftRawLandmarks: null,
    faceLandmarks: null,
    normalizedFeatures: ZERO_FEATURES,
    bothHandsPresent: false,
    facePresent: false,
    handFaceInteraction: null,
  });

  const updateFPS = useCallback(() => {
    const counter = fpsCounterRef.current;
    counter.frames++;
    const now = performance.now();
    const elapsed = now - counter.lastTime;
    if (elapsed >= 1000) {
      const fps = Math.round((counter.frames * 1000) / elapsed);
      setState(prev => ({ ...prev, fps }));
      counter.frames = 0;
      counter.lastTime = now;
    }
  }, []);

  const resetTracking = useCallback(() => {
    lastRightFeaturesRef.current = null;
    lastLeftFeaturesRef.current = null;
    rightMissingRef.current = 0;
    leftMissingRef.current = 0;
    canvasCtxRef.current = null;
    consecutiveErrorsRef.current = 0;
    faceInteractionConfirmRef.current = { region: null, frames: 0 };
    handResultRef.current = { right: null, left: null };
    faceResultRef.current = null;
  }, []);

  const stopSessionStream = useCallback((session: MediaPipeSession) => {
    session.stream?.getTracks().forEach(track => track.stop());
    if (session.video?.srcObject === session.stream) {
      session.video.srcObject = null;
    }
    session.stream = null;
    session.video = null;
  }, []);

  const teardownSession = useCallback((
    session: MediaPipeSession,
    error: string | null = null,
    publishState = true,
  ) => {
    if (!session.stopped) {
      session.stopped = true;
      if (session.raf) cancelAnimationFrame(session.raf);
      session.raf = 0;
      stopSessionStream(session);

      const closeModels = async () => {
        if (session.pendingSend) {
          try { await session.pendingSend; } catch { /* frame error is reported separately */ }
        }
        await Promise.allSettled([
          session.hands?.close?.(),
          session.face?.close?.(),
        ]);
        session.hands = null;
        session.face = null;
      };
      void closeModels();
    }

    if (sessionRef.current === session) sessionRef.current = null;
    resetTracking();

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    if (publishState && mountedRef.current) {
      setState({
        isLoading: false,
        isActive: false,
        error,
        fps: 0,
        rawLandmarks: null,
        leftRawLandmarks: null,
        faceLandmarks: null,
        normalizedFeatures: ZERO_FEATURES,
        bothHandsPresent: false,
        facePresent: false,
        handFaceInteraction: null,
      });
    }
  }, [resetTracking, stopSessionStream]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;

    const session: MediaPipeSession = {
      id: ++sessionIdRef.current,
      stopped: false,
      stream: null,
      video: null,
      hands: null,
      face: null,
      pendingSend: null,
      raf: 0,
    };
    sessionRef.current = session;

    const ownsSession = () => sessionRef.current === session && !session.stopped;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const enableFaceTracking = options.enableFaceTracking !== false;

      // ── 1. Dynamically import required MediaPipe modules ──────────────────
      const [{ Hands }, faceModule] = await Promise.all([
        import('@mediapipe/hands'),
        enableFaceTracking ? import('@mediapipe/face_mesh') : Promise.resolve(null),
      ]);
      if (!ownsSession()) return;

      // ── 2. Initialize Hands (one primary hand for the demo build) ───────
      const hands = new Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
      });
      session.hands = hands as MediaPipeModel;
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });

      type HandsResults = {
        multiHandLandmarks?: Landmark[][];
        multiHandedness?: { label: string; score: number }[];
      };

      hands.onResults((results: HandsResults) => {
        if (!ownsSession()) return;
        let right: Landmark[] | null = null;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          right = results.multiHandLandmarks[0] as Landmark[];
        }

        handResultRef.current = { right, left: null };
      });

      // ── 3. Initialize FaceMesh only where face-touch recognition is needed ─
      if (enableFaceTracking && faceModule) {
        const faceMesh = new faceModule.FaceMesh({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
        });
        session.face = faceMesh as MediaPipeModel;
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        type FaceResults = { multiFaceLandmarks?: Landmark[][] };
        faceMesh.onResults((results: FaceResults) => {
          if (!ownsSession()) return;
          faceResultRef.current = results.multiFaceLandmarks?.[0] ?? null;
        });
      } else {
        faceResultRef.current = null;
      }

      // ── 4. Start webcam ───────────────────────────────────────────────────
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      session.stream = stream;
      if (!ownsSession()) {
        stopSessionStream(session);
        return;
      }

      const video = videoRef.current;
      if (!video) throw new Error('Camera view is unavailable');
      session.video = video;
      video.srcObject = stream;
      await video.play();
      if (!ownsSession()) return;

      // ── 5. Process frames ─────────────────────────────────────────────────
      const processFrame = async () => {
        if (!ownsSession()) return;

        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          // Resize canvas to match video
          if (canvasRef.current) {
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            if (canvasRef.current.width !== vw || canvasRef.current.height !== vh) {
              canvasRef.current.width = vw;
              canvasRef.current.height = vh;
              canvasCtxRef.current = canvasRef.current.getContext('2d');
            } else if (!canvasCtxRef.current) {
              canvasCtxRef.current = canvasRef.current.getContext('2d');
            }
          }

          try {
            const handsModel = session.hands;
            const faceModel = session.face;
            if (!handsModel) throw new Error('MediaPipe Hands is unavailable');

            const pendingSend = (async () => {
              await handsModel.send({ image: video });
              if (!ownsSession()) return;
              if (enableFaceTracking && faceModel) {
                await faceModel.send({ image: video });
              } else {
                faceResultRef.current = null;
              }
            })();
            session.pendingSend = pendingSend;
            try {
              await pendingSend;
            } finally {
              if (session.pendingSend === pendingSend) session.pendingSend = null;
            }
            if (!ownsSession()) return;

            // ── Build extended 156-dim features ───────────────────────────
            const { right: rightRaw, left: leftRaw } = handResultRef.current;
            const faceRaw = faceResultRef.current;

            // Primary-hand features (with hold-on-loss)
            let rightFeatures: number[] | null = null;
            let rightPresent = false;
            let rightHeld = false;

            const rightNorm = rightRaw ? normalizeLandmarks(rightRaw) : null;
            if (rightNorm) {
              rightFeatures = rightNorm;
              rightPresent = true;
              rightHeld = false;
              rightMissingRef.current = 0;
              lastRightFeaturesRef.current = rightNorm;
            } else {
              rightMissingRef.current++;
              if (lastRightFeaturesRef.current && rightMissingRef.current <= HOLD_MISSING_FRAMES) {
                rightFeatures = lastRightFeaturesRef.current;
                rightHeld = true;
              } else {
                lastRightFeaturesRef.current = null;
              }
            }

            // Second-hand recognition is disabled for the demo build. Keep the
            // slot zeroed so existing extended-vector consumers remain stable.
            const leftFeatures: number[] | null = null;
            const leftHeld = false;

            // Face features
            const faceFeatures = enableFaceTracking && faceRaw ? normalizeFaceLandmarks(faceRaw) : null;

            // Combine into 156-dim vector
            const extendedFeatures = buildExtendedFeatures(rightFeatures, leftFeatures, faceFeatures);

            // ── Hand-face proximity detection ─────────────────────────────
            const rawInteraction = checkHandFaceInteraction(
              rightPresent ? rightRaw : null,
              null,
              enableFaceTracking ? faceRaw : null,
            );
            let interaction: HandFaceInteraction | null = null;

            if (rawInteraction) {
              const pending = faceInteractionConfirmRef.current;
              if (pending.region === rawInteraction.faceRegion) {
                pending.frames++;
              } else {
                pending.region = rawInteraction.faceRegion;
                pending.frames = 1;
              }

              if (pending.frames >= FACE_TOUCH_CONFIRM_FRAMES) {
                interaction = rawInteraction;
              }
            } else {
              faceInteractionConfirmRef.current = { region: null, frames: 0 };
            }

            // ── Draw overlay ──────────────────────────────────────────────
            const ctx = canvasCtxRef.current;
            if (ctx && canvasRef.current && options.showOverlay !== false) {
              drawMultiLandmarks(
                ctx,
                rightPresent ? rightRaw : null,
                null,
                enableFaceTracking ? faceRaw : null,
                canvasRef.current.width,
                canvasRef.current.height,
              );
            } else if (ctx && canvasRef.current) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }

            // ── Update state ──────────────────────────────────────────────
            setState(prev => ({
              ...prev,
              error: null,
              rawLandmarks: rightPresent ? rightRaw : null,
              leftRawLandmarks: null,
              faceLandmarks: enableFaceTracking ? faceRaw : null,
              normalizedFeatures: extendedFeatures,
              bothHandsPresent: false,
              facePresent: enableFaceTracking && faceRaw !== null,
              handFaceInteraction: interaction,
            }));

            // ── Emit to caller ────────────────────────────────────────────
            if (options.onLandmarks) {
              options.onLandmarks(
                extendedFeatures,
                rightPresent ? rightRaw : null,
                rightPresent,
                rightHeld,
                null,
                enableFaceTracking ? faceRaw : null,
                leftHeld,
                interaction,
                rawInteraction,
              );
            }

            updateFPS();
            consecutiveErrorsRef.current = 0;
          } catch (sendErr) {
            if (!ownsSession()) return;
            consecutiveErrorsRef.current++;
            const msg = sendErr instanceof Error ? sendErr.message : 'MediaPipe frame processing failed';
            setState(prev => ({ ...prev, error: msg }));
            if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
              teardownSession(session, msg);
              return;
            }
          }
        }

        if (ownsSession()) session.raf = requestAnimationFrame(processFrame);
      };

      session.raf = requestAnimationFrame(processFrame);

      if (ownsSession()) {
        setState(prev => ({ ...prev, isLoading: false, isActive: true }));
      }
    } catch (err) {
      if (!ownsSession()) return;
      const msg = err instanceof Error ? err.message : 'Failed to start camera';
      teardownSession(session, msg);
    }
  }, [options, stopSessionStream, teardownSession, updateFPS]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      teardownSession(session);
      return;
    }
    resetTracking();
    if (mountedRef.current) {
      setState(prev => ({ ...prev, isLoading: false, isActive: false, error: null, fps: 0 }));
    }
  }, [resetTracking, teardownSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  return { videoRef, canvasRef, state, start, stop };
}
