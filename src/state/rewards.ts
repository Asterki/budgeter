/**
 * Reward notifications.
 *
 * The store owns the rules; this tiny event channel lets the UI celebrate an
 * award without threading callbacks through every action.
 */

export interface RewardEvent {
  id: number;
  xp: number;
  message: string;
  achievements: string[];
  leveledUp: boolean;
  level: number;
}

type Listener = (event: RewardEvent) => void;

const listeners = new Set<Listener>();
let sequence = 0;

export function emitReward(event: Omit<RewardEvent, 'id'>): void {
  const payload: RewardEvent = { ...event, id: (sequence += 1) };
  for (const listener of listeners) listener(payload);
}

export function subscribeRewards(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
