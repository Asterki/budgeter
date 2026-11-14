/**
 * Hybrid logical clock.
 *
 * A fixed-width string sorts lexicographically in causal order:
 *   000001937af2c100-000003-<clientId>
 * Time moves monotonically even when a device's wall clock jumps backwards.
 */

export interface ParsedHlc {
  ms: number;
  counter: number;
  clientId: string;
}

const HLC_SIZE = 15;
const COUNTER_SIZE = 6;

export function formatHlc(ms: number, counter: number, clientId: string): string {
  return `${String(ms).padStart(HLC_SIZE, '0')}-${String(counter).padStart(COUNTER_SIZE, '0')}-${clientId}`;
}

export function parseHlc(value: string): ParsedHlc {
  const [msPart, counterPart, ...rest] = value.split('-');
  return {
    ms: Number(msPart),
    counter: Number(counterPart),
    clientId: rest.join('-'),
  };
}

export function compareHlc(a: string, b: string): number {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function epochHlc(clientId: string): string {
  return formatHlc(0, 0, clientId);
}

export class HlcClock {
  private ms = 0;
  private counter = 0;

  /**
   * @param last    The highest HLC this device has ever issued or observed.
   * @param persist Called with the new high-water mark whenever `observe`
   *                advances the clock, so a reload cannot rewind past a change
   *                that was already merged.
   */
  constructor(
    private readonly clientId: string,
    last: string | null,
    private readonly persist?: (hlc: string) => void,
  ) {
    const now = Date.now();
    this.ms = now;
    this.counter = 0;
    if (last) {
      const parsed = parseHlc(last);
      // Seed from whichever is later. When the stored value is ahead of the
      // wall clock (a peer's clock ran fast, or ours moved backwards), its
      // counter must be kept too — seeding (now, 0) when the stored value is
      // (now, 7) would move the clock backwards.
      if (parsed.ms >= now) {
        this.ms = parsed.ms;
        this.counter = parsed.counter;
      }
    }
  }

  /** The highest HLC reached so far, without advancing the clock. */
  snapshot(): string {
    return formatHlc(this.ms, this.counter, this.clientId);
  }

  next(): string {
    const now = Date.now();
    if (now > this.ms) {
      this.ms = now;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return formatHlc(this.ms, this.counter, this.clientId);
  }

  observe(remote: string): void {
    const parsed = parseHlc(remote);
    let advanced = false;
    if (parsed.ms > this.ms) {
      this.ms = parsed.ms;
      this.counter = parsed.counter;
      advanced = true;
    } else if (parsed.ms === this.ms && parsed.counter > this.counter) {
      this.counter = parsed.counter;
      advanced = true;
    }
    if (advanced) this.persist?.(this.snapshot());
  }
}
