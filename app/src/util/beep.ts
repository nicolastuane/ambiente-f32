/**
 * Short two-tone cue for the experiment ("now do the next action"). iOS only
 * lets a page play sound after a tap, so unlockAudio() must run inside a click
 * handler; later beeps then work from timers. Silent when the iPhone's mute
 * switch is on. Every failure is ignored: the cue is optional.
 */
let context: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
    }
    void context.resume();
  } catch {
    context = null;
  }
}

export function beep(): void {
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return;
  try {
    const start = ctx.currentTime + 0.02;
    [880, 1320].forEach((frequency, i) => {
      const at = start + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.15);
    });
  } catch {
    // Optional cue.
  }
}
