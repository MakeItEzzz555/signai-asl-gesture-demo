import { describe, expect, it } from 'vitest';
import { deferred } from '../test/fixtures';
import { ImportOwnership } from './importOwnership';

describe('dataset import ownership', () => {
  it.each(['clear', 'starter'])('prevents a delayed import from overwriting a later %s operation', async operation => {
    const owner = new ImportOwnership();
    const file = deferred<string>();
    const token = owner.begin();
    let published = 'initial';
    const importWork = file.promise.then(() => { if (owner.owns(token)) published = 'import'; });
    owner.invalidate();
    published = operation;
    file.resolve('{}');
    await importWork;
    expect(published).toBe(operation);
  });
});
