import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('browser test harness', () => {
  it('mounts a React component in the DOM', () => {
    render(<main>SignAI test harness</main>);
    expect(screen.getByRole('main')).toHaveTextContent('SignAI test harness');
  });

  it('commits and reads an IndexedDB transaction', async () => {
    const request = indexedDB.open('signai-harness', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const write = db.transaction('snapshots', 'readwrite');
    write.objectStore('snapshots').put({ revision: 1 }, 'current');
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => resolve();
      write.onerror = () => reject(write.error);
    });
    const read = db.transaction('snapshots').objectStore('snapshots').get('current');
    await expect(new Promise((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    })).resolves.toEqual({ revision: 1 });
    db.close();
  });
});
