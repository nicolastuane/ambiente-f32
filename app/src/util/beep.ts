/**
 * Short two-tone cue for the experiment ("now do the next action"). iOS only
 * lets a page start sound from a tap, so unlockAudio() must run inside a click
 * handler; a context started that way can be resumed later from timers. Silent
 * when the iPhone's mute switch is on. Every failure is ignored: the cue is optional.
 */
let context: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!context || context.state === 'closed') {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
    }
    context.resume().catch(() => undefined);
  } catch {
    context = null;
  }
}

function play(ctx: AudioContext): void {
  try {
    const start = ctx.currentTime + 0.02;
    [880, 1320].forEach((frequency, i) => {
      const at = start + i * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.7, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.17);
    });
  } catch {
    // Optional cue.
  }
}

/** Plays the cue, resuming a context left 'suspended' or 'interrupted' (calls, Siri, background). */
export function beep(): void {
  const ctx = context;
  if (!ctx || ctx.state === 'closed') return;
  if (ctx.state === 'running') {
    play(ctx);
    return;
  }
  ctx.resume().then(
    () => {
      if (ctx.state === 'running') play(ctx);
    },
    () => undefined,
  );
}
