/**
 * usePredictionSmoothing.ts — Prediction Smoothing for Stable Gesture Recognition
 *
 * Problem: Raw frame-by-frame predictions are noisy and flicker between classes.
 * Solution: Confirm a gesture only after N consecutive frames predict the same class.
 *
 * Algorithm:
 * 1. Maintain a rolling window of the last N predictions
 * 2. A gesture is "confirmed" when all N frames agree on the same label
 * 3. Only confirmed gestures trigger speech synthesis and text output
 * 4. Confidence is averaged over the confirmation window
 */

import { useRef, useState, useCallback } from 'react';

export interface PredictionResult {
  label: string;
  confidence: number;
  allScores?: { label: string; score: number }[];
}

export interface SmoothedPrediction {
  label: string;
  confidence: number;
  isConfirmed: boolean;
  frameCount: number;
  allScores?: { label: string; score: number }[];
}

export interface ConfirmedGesture {
  label: string;
  isNew: boolean;
}

const CONFIRMATION_FRAMES = 10; // Number of consistent frames required

export function usePredictionSmoothing() {
  const windowRef = useRef<PredictionResult[]>([]);
  const lastConfirmedRef = useRef<string>('');
  const [smoothed, setSmoothed] = useState<SmoothedPrediction | null>(null);

  const addPrediction = useCallback((prediction: PredictionResult): ConfirmedGesture | null => {
    const window = windowRef.current;
    window.push(prediction);

    // Keep only the last CONFIRMATION_FRAMES predictions
    if (window.length > CONFIRMATION_FRAMES) {
      window.shift();
    }

    if (window.length < CONFIRMATION_FRAMES) {
      // Not enough frames yet — show current prediction as unconfirmed
      setSmoothed({
        label: prediction.label,
        confidence: prediction.confidence,
        isConfirmed: false,
        frameCount: window.length,
        allScores: prediction.allScores,
      });
      return null;
    }

    // Check if all frames in the window agree
    const allSame = window.every(p => p.label === window[0].label);
    const avgConfidence = window.reduce((sum, p) => sum + p.confidence, 0) / window.length;

    if (allSame) {
      const confirmedLabel = window[0].label;
      const isNew = confirmedLabel !== lastConfirmedRef.current;

      setSmoothed({
        label: confirmedLabel,
        confidence: Number(avgConfidence.toFixed(1)),
        isConfirmed: true,
        frameCount: CONFIRMATION_FRAMES,
        allScores: prediction.allScores,
      });

      if (isNew) {
        lastConfirmedRef.current = confirmedLabel;
        return { label: confirmedLabel, isNew: true };
      }

      return { label: confirmedLabel, isNew: false };
    } else {
      // Frames disagree — show current prediction as unconfirmed
      setSmoothed({
        label: prediction.label,
        confidence: prediction.confidence,
        isConfirmed: false,
        frameCount: window.length,
        allScores: prediction.allScores,
      });
    }

    return null;
  }, []);

  const reset = useCallback(() => {
    windowRef.current = [];
    lastConfirmedRef.current = '';
    setSmoothed(null);
  }, []);

  return { smoothed, addPrediction, reset, confirmationFrames: CONFIRMATION_FRAMES };
}
