export interface SentenceEntry {
  id: string;
}

export function removeSentenceEntry<T extends SentenceEntry>(entries: T[], entryId: string): T[] {
  return entries.filter(entry => entry.id !== entryId);
}

export function isGenuineHandRelease(handPresent: boolean, isHeld: boolean): boolean {
  return !handPresent && !isHeld;
}

export function hasTrackingOwnership(handPresent: boolean, isHeld: boolean): boolean {
  return handPresent || isHeld;
}

export class OwnedEmissionQueue<T> {
  private pending: { generation: number; value: T } | null = null;

  store(generation: number, value: T): void {
    this.pending = { generation, value };
  }

  take(generation: number): T | null {
    if (!this.pending || this.pending.generation !== generation) return null;
    const value = this.pending.value;
    this.pending = null;
    return value;
  }

  invalidate(): void {
    this.pending = null;
  }
}
