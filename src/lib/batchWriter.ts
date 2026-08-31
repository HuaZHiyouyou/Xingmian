/**
 * BatchWriter - 防抖批量写入器
 * 将高频的小写入操作合并为低频的批量写入，减少数据库压力
 */
export class BatchWriter<T> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushFn: (items: T[]) => Promise<void>;
  private batchSize: number;
  private debounceMs: number;

  constructor(
    flushFn: (items: T[]) => Promise<void>,
    options: { batchSize?: number; debounceMs?: number } = {}
  ) {
    this.flushFn = flushFn;
    this.batchSize = options.batchSize ?? 20;
    this.debounceMs = options.debounceMs ?? 2000;
  }

  add(item: T) {
    this.buffer.push(item);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  addMany(items: T[]) {
    this.buffer.push(...items);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const items = [...this.buffer];
    this.buffer = [];
    try {
      await this.flushFn(items);
    } catch (e) {
      console.error('BatchWriter flush error:', e);
    }
  }

  get pendingCount() {
    return this.buffer.length;
  }

  private scheduleFlush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }
}
