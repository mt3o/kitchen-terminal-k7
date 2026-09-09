<!--
  AUDIOMETR — kitchen noise-level card. Listens to the microphone (Web Audio
  API / getUserMedia) and shows the current level plus a scrolling histogram
  of the last `historyDurationSeconds`.

  A kiosk cannot prompt for microphone access on load and must never render a
  dead card while waiting on a permission nobody asked for yet, so this never
  touches getUserMedia until the household presses the one solid amber
  control. See audiometer.ts for the pure math (percent/dB conversion,
  history windowing, smoothing, threshold check) — kept apart so it is
  testable without a DOM or a MediaStream.

  Card state mapping: idle/pending -> idle, listening -> ok (or warn over
  threshold), denied/error -> fail.
-->
<svelte:options
  customElement={{
    tag: 'k7-audiometer',
    props: {
      historyDurationSeconds: { reflect: true },
      sampleIntervalMs: { reflect: true },
      unit: { reflect: true },
      showCurrentLevel: { reflect: true },
      showHistogram: { reflect: true },
      smoothingFactor: { reflect: true },
      warningThreshold: { reflect: true },
      micDeviceId: { reflect: true }
    }
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'
  import { toPercent, toDecibels, pushSample, smooth, exceedsThreshold } from './audiometer.ts'

  interface Props {
    /** Custom-element attrs are always strings. */
    historyDurationSeconds?: string
    sampleIntervalMs?: string
    unit?: string
    showCurrentLevel?: string
    showHistogram?: string
    smoothingFactor?: string
    warningThreshold?: string
    micDeviceId?: string
  }

  let {
    historyDurationSeconds = '180',
    sampleIntervalMs = '500',
    unit = 'percent',
    showCurrentLevel = 'true',
    showHistogram = 'true',
    smoothingFactor = '0.3',
    warningThreshold = '',
    micDeviceId = ''
  }: Props = $props()

  type Phase = 'idle' | 'pending' | 'listening' | 'denied' | 'error'

  const asBool = (v: string, fallback: boolean): boolean => {
    const t = v.trim().toLowerCase()
    if (t === 'true') return true
    if (t === 'false') return false
    return fallback
  }
  const asNumber = (v: string, fallback: number): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }

  let historySeconds = $derived(Math.max(1, asNumber(historyDurationSeconds, 180)))
  let intervalMs = $derived(Math.max(50, asNumber(sampleIntervalMs, 500)))
  let unitMode = $derived(unit.trim().toLowerCase() === 'db' ? 'db' : 'percent')
  let wantCurrentLevel = $derived(asBool(showCurrentLevel, true))
  let wantHistogram = $derived(asBool(showHistogram, true))
  let smoothingFactorValue = $derived(Math.min(1, Math.max(0, asNumber(smoothingFactor, 0.3))))
  let threshold = $derived(warningThreshold.trim() === '' ? undefined : asNumber(warningThreshold, NaN))
  let maxSamples = $derived(Math.max(1, Math.round((historySeconds * 1000) / intervalMs)))

  let cardPhase = $state<Phase>('idle')
  let errorMessage = $state('')
  let currentValue = $state(0) // smoothed, in the display unit
  let history = $state<number[]>([])

  let stream: MediaStream | undefined
  let audioCtx: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let sampleTimer: ReturnType<typeof setInterval> | undefined

  const toDisplay = (rms: number): number => (unitMode === 'db' ? toDecibels(rms) : toPercent(rms))

  let overThreshold = $derived(exceedsThreshold(currentValue, threshold))

  let cardState = $derived<'ok' | 'warn' | 'fail' | 'idle'>(
    cardPhase === 'denied' || cardPhase === 'error'
      ? 'fail'
      : cardPhase === 'listening'
        ? overThreshold
          ? 'warn'
          : 'ok'
        : 'idle'
  )

  function readRms(): number {
    if (!analyser) return 0
    const buf = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(buf)
    let sumSquares = 0
    for (let i = 0; i < buf.length; i++) {
      const centred = (buf[i] - 128) / 128
      sumSquares += centred * centred
    }
    return Math.sqrt(sumSquares / buf.length)
  }

  function sample(): void {
    const rms = readRms()
    const raw = toDisplay(rms)
    currentValue = smooth(currentValue, raw, smoothingFactorValue)
    history = pushSample(history, currentValue, maxSamples)
  }

  function teardownAudio(): void {
    if (sampleTimer !== undefined) {
      clearInterval(sampleTimer)
      sampleTimer = undefined
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = undefined
    }
    if (audioCtx) {
      // AudioContext.close() rejects if already closed — harmless here, but
      // a kiosk left running for months must never accumulate open contexts.
      try {
        void audioCtx.close()
      } catch {
        /* already closed */
      }
      audioCtx = undefined
    }
    analyser = undefined
  }

  async function enableMic(): Promise<void> {
    cardPhase = 'pending'
    errorMessage = ''
    try {
      const constraints: MediaStreamConstraints = {
        audio: micDeviceId.trim() === '' ? true : { deviceId: { exact: micDeviceId.trim() } }
      }
      stream = await navigator.mediaDevices.getUserMedia(constraints)
      const AudioCtx =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) throw new Error('no-audio-context')
      audioCtx = new AudioCtx()
      const source = audioCtx.createMediaStreamSource(stream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)

      currentValue = 0
      history = []
      cardPhase = 'listening'
      sampleTimer = setInterval(sample, intervalMs)
    } catch (err) {
      teardownAudio()
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        cardPhase = 'denied'
        errorMessage = 'odmowa dostepu do mikrofonu'
      } else if (name === 'NotFoundError') {
        cardPhase = 'error'
        errorMessage = 'brak mikrofonu'
      } else {
        cardPhase = 'error'
        errorMessage = 'blad mikrofonu'
      }
    }
  }

  // Always torn down on unmount, and whenever the component is re-created —
  // a display that holds the microphone open forever is both a battery and
  // a privacy problem.
  $effect(() => {
    return () => teardownAudio()
  })

  const fmt = (v: number): string => (unitMode === 'db' ? `${Math.round(v)} dB` : `${Math.round(v)}%`)
</script>

<Card label="AUDIOMETR" state={cardState}>
  {#if cardPhase === 'idle'}
    <div class="prompt">
      <p class="msg">mikrofon wylaczony</p>
      <button type="button" class="btn-solid" onclick={enableMic}>wlacz mikrofon</button>
    </div>
  {:else if cardPhase === 'pending'}
    <div class="prompt">
      <p class="msg">oczekiwanie na zgode</p>
    </div>
  {:else if cardPhase === 'denied' || cardPhase === 'error'}
    <div class="prompt">
      <p class="msg fail-msg">{errorMessage}</p>
      <button type="button" class="btn-ghost" onclick={enableMic}>sprobuj ponownie</button>
    </div>
  {:else}
    <div class="reading">
      {#if wantCurrentLevel}
        <p class="level" class:warn={overThreshold}>{fmt(currentValue)}</p>
      {/if}
      {#if wantHistogram}
        <div class="histogram" role="img" aria-label="historia poziomu glosnosci">
          {#each history as v, i (i)}
            <div
              class="bar"
              class:warn={exceedsThreshold(v, threshold)}
              style:height={`${unitMode === 'db' ? Math.max(0, ((v + 60) / 60) * 100) : Math.max(0, v)}%`}
            ></div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</Card>

<style>
  .prompt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--space-3);
    height: 100%;
  }

  .msg {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }

  .fail-msg {
    color: var(--fail);
  }

  .reading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
  }

  /* Glance tier: the current level is read from the doorway. */
  .level {
    margin: 0;
    font-size: var(--glance-sm);
    line-height: var(--leading-glance);
    font-variant-numeric: tabular-nums;
    color: var(--fg);
  }
  .level.warn {
    color: var(--warn);
  }

  .histogram {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
    border-top: var(--border-w) solid var(--border);
    padding-top: var(--space-2);
  }

  .bar {
    flex: 1 1 auto;
    min-width: 2px;
    background: var(--signal);
    transition: height var(--motion-fast) var(--ease);
  }
  .bar.warn {
    background: var(--warn);
  }

  button {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    border-radius: var(--radius);
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease);
  }

  /* The single solid amber control this card gets — turning the mic on. */
  .btn-solid {
    min-height: var(--control-h);
    padding: 0 var(--control-pad-x);
    background: var(--accent);
    color: var(--accent-fg);
    border: var(--border-w-strong) solid var(--accent);
  }
  .btn-solid:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn-solid:active {
    background: var(--accent-active);
    border-color: var(--accent-active);
  }

  .btn-ghost {
    min-height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    background: transparent;
    color: var(--fg);
    border: var(--border-w-strong) solid var(--border-strong);
  }
  .btn-ghost:hover {
    background: var(--ghost-hover);
    color: var(--fg);
  }
  .btn-ghost:active {
    background: var(--ghost-active);
  }

  button:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    button:focus {
      outline: none;
    }
    button:focus-visible {
      outline: var(--focus-w) solid var(--focus);
      outline-offset: var(--focus-offset);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar,
    button {
      transition-duration: 0ms;
    }
  }
</style>
