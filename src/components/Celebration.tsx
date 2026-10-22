/**
 * The completion feedback layer.
 *
 * Ticking a task fires an immediate burst at the checkbox (particles, a ripple
 * and a floating "+XP"), plus optional haptics and a short synthesised chime.
 * Level-ups and milestones arrive a moment later as a toast, so the reward is
 * layered rather than all at once.
 *
 * The layer is fixed and pointer-events:none, so celebrations survive the task
 * row unmounting the instant it is completed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CompletionOutcome } from '../domain/progress';
import { useTasker } from '../state/store';

type Tone = 'normal' | 'checklist' | 'level';

export interface Point {
  x: number;
  y: number;
}

interface Particle {
  tx: number;
  ty: number;
  delay: number;
  color: string;
  size: number;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  xp: number;
  tone: Tone;
  particles: Particle[];
}

interface Toast {
  id: number;
  icon: string;
  title: string;
  subtitle?: string;
  tone: Tone;
}

interface CelebrationApi {
  /** Immediate feedback at a screen point. */
  celebrate: (point: Point, xp: number, tone?: Tone) => void;
  /** Post-commit rewards: level ups and daily milestones. */
  announce: (outcome: CompletionOutcome, point?: Point) => void;
  notify: (toast: { icon?: string; title: string; subtitle?: string }) => void;
}

const CelebrationContext = createContext<CelebrationApi | null>(null);

const TONE_COLORS: Record<Tone, string[]> = {
  normal: ['#263BAA', '#8FA8BE', '#4C8C8C', '#6E839A'],
  checklist: ['#3F7A5E', '#8FA8BE', '#263BAA', '#9E7B3F'],
  level: ['#C07F2E', '#263BAA', '#3F7A5E', '#8C6E9E', '#C2453D'],
};

/** Chime notes, chosen per tone. */
const TONE_NOTES: Record<Tone, number[]> = {
  normal: [880, 1174.66],
  checklist: [659.25, 880, 1318.51],
  level: [523.25, 659.25, 783.99, 1046.5],
};

let audioContext: AudioContext | null = null;

/** A tiny synthesised chime — no audio asset, so it works offline. */
function playChime(tone: Tone): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const context = audioContext;
    TONE_NOTES[tone].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.065;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.09, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
  } catch {
    // Audio is a nice-to-have; never let it break a completion.
  }
}

function vibrate(tone: Tone): void {
  try {
    navigator.vibrate?.(tone === 'normal' ? 12 : [10, 40, 18]);
  } catch {
    // Unsupported on desktop — ignore.
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const { settings, tasks } = useTasker();
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const nextId = () => {
    counter.current += 1;
    return counter.current;
  };

  const celebrate = useCallback<CelebrationApi['celebrate']>(
    (point, xp, tone = 'normal') => {
      const reduced = prefersReducedMotion();
      const palette = TONE_COLORS[tone];
      const particles: Particle[] = reduced
        ? []
        : Array.from({ length: tone === 'normal' ? 12 : 18 }, (_, index) => {
            const angle = (Math.PI * 2 * index) / (tone === 'normal' ? 12 : 18) + Math.random() * 0.5;
            return {
              tx: Math.cos(angle) * (46 + Math.random() * 54),
              ty: Math.sin(angle) * (46 + Math.random() * 54),
              delay: Math.random() * 90,
              color: palette[index % palette.length],
              size: 4 + Math.random() * 5,
            };
          });

      const burst: Burst = { id: nextId(), x: point.x, y: point.y, xp, tone, particles };
      setBursts((prev) => [...prev.slice(-6), burst]);
      window.setTimeout(() => setBursts((prev) => prev.filter((item) => item.id !== burst.id)), 1100);

      if (settings.soundEnabled) playChime(tone);
      vibrate(tone);
    },
    [settings.soundEnabled],
  );

  const toast = useCallback((entry: Omit<Toast, 'id'>) => {
    const item: Toast = { ...entry, id: nextId() };
    setToasts((prev) => [...prev.slice(-2), item]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== item.id)), 3400);
  }, []);

  const notify = useCallback<CelebrationApi['notify']>(
    ({ icon = '✨', title, subtitle }) => toast({ icon, title, subtitle, tone: 'normal' }),
    [toast],
  );

  const announce = useCallback<CelebrationApi['announce']>(
    (outcome, point) => {
      if (outcome.leveledUp) {
        const done = tasks.filter((task) => task.completed).length;
        toast({
          icon: '🏅',
          title: `Level ${outcome.level.level}`,
          subtitle: `${done} tasks completed · ${outcome.progress.xp} XP`,
          tone: 'level',
        });
        if (point) celebrate(point, outcome.xpGain, 'level');
        else if (settings.soundEnabled) playChime('level');
        return;
      }
      if (outcome.milestone) {
        toast({ icon: '🔥', title: outcome.milestone, subtitle: `${outcome.progress.streak} day streak`, tone: 'checklist' });
      }
      if (outcome.clearedParentId && point) {
        celebrate(point, outcome.xpGain, 'checklist');
      }
    },
    [celebrate, settings.soundEnabled, tasks, toast],
  );

  const api = useRef<CelebrationApi>({ celebrate, announce, notify });
  api.current = { celebrate, announce, notify };
  const value = api.current;

  return (
    <CelebrationContext.Provider value={value}>
      {children}

      <div className="celebrate-layer" aria-hidden="true">
        {bursts.map((burst) => (
          <div className="burst" key={burst.id} style={{ left: burst.x, top: burst.y }}>
            <span className={`burst__ring burst__ring--${burst.tone}`} />
            {burst.particles.map((particle, index) => (
              <span
                key={index}
                className="burst__particle"
                style={{
                  background: particle.color,
                  width: particle.size,
                  height: particle.size,
                  ['--tx' as string]: `${particle.tx}px`,
                  ['--ty' as string]: `${particle.ty}px`,
                  animationDelay: `${particle.delay}ms`,
                }}
              />
            ))}
            <span className={`burst__xp burst__xp--${burst.tone}`}>+{burst.xp} XP</span>
          </div>
        ))}
      </div>

      <div className="toast-layer" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div className={`toast toast--${item.tone}`} key={item.id}>
            <span className="toast__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="toast__text">
              <strong>{item.title}</strong>
              {item.subtitle && <em>{item.subtitle}</em>}
            </span>
          </div>
        ))}
      </div>
    </CelebrationContext.Provider>
  );
}

export function useCelebration(): CelebrationApi {
  const context = useContext(CelebrationContext);
  if (!context) throw new Error('useCelebration must be used inside <CelebrationProvider>.');
  return context;
}
