/** Toast and sound feedback for XP, levels and achievements. */

import { useEffect, useState } from 'react';
import { FiAward, FiZap } from 'react-icons/fi';

import { subscribeRewards, type RewardEvent } from '../state/rewards';
import type { Settings } from '../domain/types';

interface RewardsProps {
  settings: Settings;
}

function playChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
    oscillator.addEventListener('ended', () => void context.close());
  } catch {
    // Audio is a nicety; never block a save because a device refuses it.
  }
}

export function Rewards({ settings }: RewardsProps) {
  const [toasts, setToasts] = useState<RewardEvent[]>([]);

  useEffect(() => {
    return subscribeRewards((event) => {
      setToasts((current) => [...current.slice(-2), event]);
      if (settings.soundEnabled) playChime();
      if (settings.hapticsEnabled && typeof navigator.vibrate === 'function') {
        navigator.vibrate(event.leveledUp ? [12, 40, 12] : 10);
      }
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== event.id));
      }, 4600);
    });
  }, [settings.soundEnabled, settings.hapticsEnabled]);

  if (toasts.length === 0) return null;

  return (
    <div className="reward-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`reward-toast${toast.leveledUp ? ' reward-toast--level' : ''}`}>
          <span className="reward-toast__icon" aria-hidden="true">
            {toast.leveledUp ? <FiAward /> : <FiZap />}
          </span>
          <div className="reward-toast__body">
            <strong>
              {toast.leveledUp ? `Level ${toast.level}` : `+${toast.xp} XP`}
            </strong>
            <span>{toast.message}</span>
            {toast.achievements.length > 0 && (
              <span className="reward-toast__achievements">
                {toast.achievements.map((title) => (
                  <span key={title} className="chip chip--new">
                    {title}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
