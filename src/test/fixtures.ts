export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function createSyntheticStream() {
  const track = {
    readyState: 'live' as MediaStreamTrackState,
    stop() { this.readyState = 'ended'; },
  } as MediaStreamTrack;
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

export function installRafFixture() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = (callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  const cancel = (id: number) => callbacks.delete(id);
  const flush = (time = 0) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach(callback => callback(time));
  };
  return { request, cancel, flush, pending: () => callbacks.size };
}
