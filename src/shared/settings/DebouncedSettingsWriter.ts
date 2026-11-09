/** Coalesces text drafts before they enter the host's transactional settings queue. */
export class DebouncedSettingsWriter<T> {
  private readonly pending = new Map<string, (settings: T) => void>();
  private inFlight: ReadonlyMap<string, (settings: T) => void> | null = null;
  private timer: number | undefined;
  private saving = Promise.resolve(true);

  constructor(
    private readonly save: (mutation: (settings: T) => void) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(key: string, mutation: (settings: T) => void): void {
    this.pending.set(key, mutation);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.flush(); }, 500);
  }

  /** Initializes settings controls from their newest drafts, including a save still awaiting persistence. */
  projectDraft(committed: T): T {
    const draft = structuredClone(committed);
    const mutations = new Map(this.inFlight ?? []);
    for (const [key, mutation] of this.pending) mutations.set(key, mutation);
    for (const mutation of mutations.values()) mutation(draft);
    return draft;
  }

  flush(): Promise<boolean> {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.size === 0) return this.saving;
    this.saving = this.saving.then(async () => {
      if (this.pending.size === 0) return true;
      const mutations = new Map(this.pending);
      this.pending.clear();
      this.inFlight = mutations;
      try {
        await this.save(settings => {
          for (const mutation of mutations.values()) mutation(settings);
        });
        return true;
      } catch (error) {
        // A committed save only failed to publish; retrying it would repeat a durable mutation.
        const committed = error !== null && typeof error === 'object'
          && 'committed' in error && error.committed === true;
        if (!committed) {
          for (const [key, mutation] of mutations) {
            if (!this.pending.has(key)) this.pending.set(key, mutation);
          }
        }
        this.onError(error);
        return false;
      } finally {
        this.inFlight = null;
      }
    });
    return this.saving;
  }
}
