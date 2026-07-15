// Lightweight Web Audio sound bank. Decodes each clip once and plays it through
// short polyphonic buffer-source voices, so rapid overlapping fire (a SAW, several
// shooters at once) never cuts itself off. Kept out of the pure sim: the engine
// diffs the world's shot/blast totals and calls play() — audio is never authoritative.

export type SfxName = 'rifle' | 'shotgun' | 'mg' | 'pistol' | 'grenade' | 'blast';

export interface PlayOpts {
  /** 0..1 relative to master. */
  volume?: number;
  /** Playback rate (pitch). 1 = original. */
  rate?: number;
  /** Cut the clip to this many seconds with a tiny fade — used to slice a single
   *  crack out of a longer sample for automatic weapons. */
  duration?: number;
}

const MAX_VOICES = 24; // hard cap so a firefight can't pile up hundreds of sources

export class AudioBank {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private muted = false;
  private started = false;
  private voices = 0;

  constructor(private readonly sources: Record<SfxName, string>) {}

  /** Create the context (must follow a user gesture) and decode all clips once. */
  async unlock(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => {});
      return;
    }
    this.started = true;
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      await Promise.all(
        (Object.keys(this.sources) as SfxName[]).map(async (name) => {
          try {
            const res = await fetch(this.sources[name]);
            const bytes = await res.arrayBuffer();
            this.buffers.set(name, await this.ctx!.decodeAudioData(bytes));
          } catch {
            /* one clip failing to load/decode shouldn't kill the rest */
          }
        }),
      );
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }
  isMuted(): boolean {
    return this.muted;
  }

  play(name: SfxName, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    const buf = this.buffers.get(name);
    if (!buf || this.voices >= MAX_VOICES) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;

    const gain = ctx.createGain();
    const vol = opts.volume ?? 1;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now); // 5 ms attack ramp avoids clicks
    gain.gain.linearRampToValueAtTime(vol, now + 0.005);

    let stopAt: number | null = null;
    if (opts.duration != null) {
      const end = now + opts.duration;
      gain.gain.setValueAtTime(vol, Math.max(now + 0.005, end - 0.04));
      gain.gain.linearRampToValueAtTime(0, end); // 40 ms release
      stopAt = end + 0.02;
    }

    src.connect(gain).connect(master);
    this.voices++;
    src.onended = () => {
      this.voices--;
    };
    src.start(now);
    if (stopAt != null) src.stop(stopAt);
  }
}
