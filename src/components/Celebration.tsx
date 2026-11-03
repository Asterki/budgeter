/**
 * The completion feedback layer.
 *
 * Ticking a task fires an immediate burst at the checkbox (particles, a ripple
 * and a floating "+XP ×combo"), plus haptics and an optional chime. A moment
 * later the rewards land as toasts — level-ups, achievements and daily
 * milestones — and an Undo pill appears at the bottom so a mis-tap is harmless.
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
import type { CompletionOutcome, CompletionUndo } from '../domain/progress';
import { useTasker } from '../state/store';

type Tone = 'normal' | 'checklist' | 'level';

export interface Point {
  x: number;
  y: number;
}

export interface Gain {
  xp: number;
  multiplier: number;
}

interface Particle {
  tx: number;
  ty: number;
  delay: number;
  color: string;
  size: number;
  round: boolean;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  xp: number;
  multiplier: number;
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

interface PendingUndo {
  id: number;
  undo: CompletionUndo;
}

interface CelebrationApi {
  /** Immediate feedback at a screen point. */
  celebrate: (point: Point, gain: Gain, tone?: Tone) => void;
  /** Post-commit rewards: levels, achievements, milestones and Undo. */
  announce: (outcome: CompletionOutcome, point?: Point) => void;
  notify: (toast: { icon?: string; title: string; subtitle?: string }) => void;
}

const CelebrationContext = createContext<CelebrationApi | null>(null);

const TONE_COLORS: Record<Tone, string[]> = {
  normal: ['#3fb950', '#58a6ff', '#39c5cf', '#8b949e'],
  checklist: ['#3fb950', '#58a6ff', '#d29922', '#bc8cff'],
  level: ['#d29922', '#58a6ff', '#3fb950', '#bc8cff', '#f85149', '#39c5cf'],
};

/** Haptic patterns (ms on, ms off…), scaled by how big the moment is. */
const TONE_HAPTICS: Record<Tone, number | number[]> = {
  normal: 14,
  checklist: [12, 28, 12, 28, 22],
  level: [16, 40, 16, 40, 16, 40, 48],
};

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

function haptic(tone: Tone): void {
  try {
    navigator.vibrate?.(TONE_HAPTICS[tone]);
  } catch {
    // Unsupported (most desktops) — ignore.
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const { settings, undoCompletion } = useTasker();
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingUndo | null>(null);
  const counter = useRef(0);
  const undoTimer = useRef<number | null>(null);

  const nextId = () => {
    counter.current += 1;
    return counter.current;
  };

  const celebrate = useCallback<CelebrationApi['celebrate']>(
    (point, gain, tone = 'normal') => {
      const reduced = prefersReducedMotion();
      const palette = TONE_COLORS[tone];
      const count = tone === 'normal' ? 12 : 20;
      const particles: Particle[] = reduced
        ? []
        : Array.from({ length: count }, (_, index) => {
            const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
            const spread = tone === 'normal' ? 44 : 62;
            return {
              tx: Math.cos(angle) * (spread + Math.random() * 52),
              ty: Math.sin(angle) * (spread + Math.random() * 52),
              delay: Math.random() * 90,
              color: palette[index % palette.length],
              size: 4 + Math.random() * 5,
              round: index % 3 === 0,
            };
          });

      const burst: Burst = {
        id: nextId(),
        x: point.x,
        y: point.y,
        xp: gain.xp,
        multiplier: gain.multiplier,
        tone,
        particles,
      };
      setBursts((prev) => [...prev.slice(-6), burst]);
      window.setTimeout(() => setBursts((prev) => prev.filter((item) => item.id !== burst.id)), 1100);

      if (settings.soundEnabled) playChime(tone);
      if (settings.hapticsEnabled) haptic(tone);
    },
    [settings.hapticsEnabled, settings.soundEnabled],
  );

  const toast = useCallback((entry: Omit<Toast, 'id'>) => {
    const item: Toast = { ...entry, id: nextId() };
    setToasts((prev) => [...prev.slice(-2), item]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== item.id)), 3600);
  }, []);

  const notify = useCallback<CelebrationApi['notify']>(
    ({ icon = '✨', title, subtitle }) => toast({ icon, title, subtitle, tone: 'normal' }),
    [toast],
  );

  const offerUndo = useCallback((undo: CompletionUndo) => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    const entry: PendingUndo = { id: nextId(), undo };
    setPending(entry);
    undoTimer.current = window.setTimeout(() => {
      setPending((current) => (current?.id === entry.id ? null : current));
    }, 6000);
  }, []);

  const announce = useCallback<CelebrationApi['announce']>(
    (outcome, point) => {
      if (outcome.leveledUp) {
        toast({
          icon: '🏅',
          title: `Level ${outcome.level.level}`,
          subtitle: `${outcome.progress.xp} XP · ${outcome.progress.totalCompleted} completed`,
          tone: 'level',
        });
        if (point) celebrate(point, { xp: outcome.xpGain, multiplier: outcome.multiplier }, 'level');
        else if (settings.soundEnabled) playChime('level');
      } else if (outcome.clearedParentId && point) {
        celebrate(point, { xp: outcome.checklistBonus, multiplier: 1 }, 'checklist');
      }

      for (const achievement of outcome.achievements) {
        toast({
          icon: achievement.icon,
          title: achievement.title,
          subtitle: achievement.description,
          tone: 'level',
        });
      }

      if (outcome.milestone) {
        toast({
          icon: '🔥',
          title: outcome.milestone,
          subtitle: `${outcome.progress.streak}-day streak`,
          tone: 'checklist',
        });
      }

      if (outcome.undo) offerUndo(outcome.undo);
    },
    [celebrate, offerUndo, settings.soundEnabled, toast],
  );

  const handleUndo = useCallback(
    (entry: PendingUndo) => {
      undoCompletion(entry.undo);
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
      setPending(null);
      if (settings.hapticsEnabled) haptic('normal');
    },
    [settings.hapticsEnabled, undoCompletion],
  );

  const value: CelebrationApi = { celebrate, announce, notify };

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
                className={`burst__particle${particle.round ? ' burst__particle--round' : ''}`}
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
            <span className={`burst__xp burst__xp--${burst.tone}`}>
              +{burst.xp} XP
              {burst.multiplier > 1 && <b className="burst__combo"> ×{burst.multiplier}</b>}
            </span>
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

      {pending && (
        <div className="undo-pill" role="status">
          <span className="undo-pill__text">
            Done: <strong>{pending.undo.label}</strong>
          </span>
          <button type="button" className="undo-pill__button" onClick={() => handleUndo(pending)}>
            Undo
          </button>
        </div>
      )}
    </CelebrationContext.Provider>
  );
}

export function useCelebration(): CelebrationApi {
  const context = useContext(CelebrationContext);
  if (!context) throw new Error('useCelebration must be used inside <CelebrationProvider>.');
  return context;
}
