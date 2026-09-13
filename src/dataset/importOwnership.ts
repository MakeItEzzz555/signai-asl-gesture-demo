/** Generation token used so the most recent dataset operation owns publication. */
export class ImportOwnership {
  private generation = 0;
  begin(): number { return ++this.generation; }
  invalidate(): void { ++this.generation; }
  owns(token: number): boolean { return token === this.generation; }
}
