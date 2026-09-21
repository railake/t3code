import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

export interface FileSaveCoordinatorOptions<T, A, E> {
  readonly debounceMs: number;
  readonly persist: (contents: T) => Promise<AtomCommandResult<A, E>>;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onConfirmed: (contents: T, result: A) => void;
}

export class FileSaveCoordinator<T = string, A = unknown, E = unknown> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents: T | undefined;
  private latestRevision = 0;
  private confirmedRevision = 0;
  private lastChangeAt = 0;
  private saving = false;
  private disposed = false;

  constructor(private readonly options: FileSaveCoordinatorOptions<T, A, E>) {}

  change(contents: T): void {
    if (this.disposed) return;
    this.latestContents = contents;
    this.latestRevision += 1;
    this.lastChangeAt = Date.now();
    this.options.onPendingChange(true);
    this.schedule(this.options.debounceMs);
  }

  /** Flush immediately (Cmd/Ctrl+S). */
  flush(): void {
    if (this.disposed) return;
    this.clearTimer();
    void this.persistLatest();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.latestRevision > 0) void this.persistLatest();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<void> {
    if (this.saving || this.latestRevision === this.confirmedRevision) return;
    if (this.latestContents === undefined) return;

    this.saving = true;
    const contents = this.latestContents;
    const revision = this.latestRevision;
    const result = await this.options.persist(contents);
    const succeeded = result._tag === "Success";
    if (succeeded) {
      this.confirmedRevision = revision;
      this.options.onConfirmed(contents, result.value);
    }

    this.saving = false;
    if (revision === this.latestRevision) {
      if (succeeded) this.options.onPendingChange(false);
      return;
    }

    const remainingDebounce = Math.max(
      0,
      this.options.debounceMs - (Date.now() - this.lastChangeAt),
    );
    if (this.disposed) {
      void this.persistLatest();
    } else {
      this.schedule(remainingDebounce);
    }
  }
}
