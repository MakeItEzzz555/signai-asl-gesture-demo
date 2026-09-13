import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyntheticStream, deferred, installRafFixture } from '../test/fixtures';
import { useMediaPipe } from './useMediaPipe';

const mocks = vi.hoisted(() => ({
  hands: [] as Array<{
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    results: ((value: { multiHandLandmarks?: unknown[][] }) => void) | null;
  }>,
  sendImpl: async () => undefined,
}));

vi.mock('@mediapipe/hands', () => ({
  Hands: class Hands {
    send = vi.fn(() => mocks.sendImpl());
    close = vi.fn(async () => undefined);
    results: ((value: { multiHandLandmarks?: unknown[][] }) => void) | null = null;

    constructor() { mocks.hands.push(this); }
    setOptions() {}
    onResults(callback: (value: { multiHandLandmarks?: unknown[][] }) => void) {
      this.results = callback;
    }
  },
}));

vi.mock('@mediapipe/face_mesh', () => ({
  FaceMesh: class FaceMesh {
    async send() {}
    async close() {}
    setOptions() {}
    onResults() {}
  },
}));

function attachVideo(result: { current: ReturnType<typeof useMediaPipe> }) {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    play: { configurable: true, value: vi.fn(async () => undefined) },
    readyState: { configurable: true, value: 2 },
    videoWidth: { configurable: true, value: 640 },
    videoHeight: { configurable: true, value: 480 },
  });
  result.current.videoRef.current = video;
  return video;
}

async function flushFrame(raf: ReturnType<typeof installRafFixture>) {
  await act(async () => {
    raf.flush();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useMediaPipe camera ownership', () => {
  let raf: ReturnType<typeof installRafFixture>;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.hands.length = 0;
    mocks.sendImpl = async () => undefined;
    raf = installRafFixture();
    vi.stubGlobal('requestAnimationFrame', raf.request);
    vi.stubGlobal('cancelAnimationFrame', raf.cancel);
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  it('owns a delayed permission stream and stops it after cancellation', async () => {
    const permission = deferred<MediaStream>();
    const stale = createSyntheticStream();
    const current = createSyntheticStream();
    getUserMedia
      .mockReturnValueOnce(permission.promise)
      .mockResolvedValueOnce(current.stream);
    const { result } = renderHook(() => useMediaPipe({ enableFaceTracking: false }));
    attachVideo(result);

    let starting!: Promise<void>;
    act(() => { starting = result.current.start(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => result.current.stop());
    attachVideo(result);
    await act(async () => { await result.current.start(); });
    permission.resolve(stale.stream);
    await act(async () => { await starting; await Promise.resolve(); });

    expect(stale.track.readyState).toBe('ended');
    expect(current.track.readyState).toBe('live');
    expect(result.current.state.isActive).toBe(true);
    act(() => result.current.stop());
    expect(current.track.readyState).toBe('ended');
  });

  it('deduplicates Start and releases the captured stream after the ref is nulled on unmount', async () => {
    const { stream, track } = createSyntheticStream();
    getUserMedia.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useMediaPipe({ enableFaceTracking: false }));
    attachVideo(result);

    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.state.isActive).toBe(true);

    result.current.videoRef.current = null;
    unmount();
    expect(track.readyState).toBe('ended');
    expect(raf.pending()).toBe(0);
  });

  it('does not publish or close a model until an in-flight send settles', async () => {
    const send = deferred<void>();
    const { stream, track } = createSyntheticStream();
    const onLandmarks = vi.fn();
    mocks.sendImpl = () => send.promise;
    getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useMediaPipe({ enableFaceTracking: false, onLandmarks }));
    attachVideo(result);
    await act(async () => { await result.current.start(); });

    await flushFrame(raf);
    act(() => result.current.stop());
    expect(track.readyState).toBe('ended');
    expect(mocks.hands[0].close).not.toHaveBeenCalled();

    send.resolve();
    await act(async () => { await send.promise; await Promise.resolve(); });
    expect(mocks.hands[0].close).toHaveBeenCalledTimes(1);
    expect(onLandmarks).not.toHaveBeenCalled();
    expect(raf.pending()).toBe(0);
  });

  it('clears a transient frame error and fully tears down at the fatal threshold so retry works', async () => {
    const first = createSyntheticStream();
    const second = createSyntheticStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    mocks.sendImpl = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useMediaPipe({ enableFaceTracking: false }));
    attachVideo(result);
    await act(async () => { await result.current.start(); });

    await flushFrame(raf);
    expect(result.current.state.error).toBe('transient');
    await flushFrame(raf);
    expect(result.current.state.error).toBeNull();

    mocks.sendImpl = vi.fn().mockRejectedValue(new Error('fatal'));
    for (let count = 0; count < 5; count++) await flushFrame(raf);
    expect(result.current.state.isActive).toBe(false);
    expect(result.current.state.error).toBe('fatal');
    expect(first.track.readyState).toBe('ended');
    expect(raf.pending()).toBe(0);

    mocks.sendImpl = async () => undefined;
    attachVideo(result);
    await act(async () => { await result.current.start(); });
    expect(result.current.state.isActive).toBe(true);
    act(() => result.current.stop());
    expect(second.track.readyState).toBe('ended');
  });
});
