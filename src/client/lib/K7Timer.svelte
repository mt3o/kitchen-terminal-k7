<!--
  MINUTNIK — kitchen countdown timer. Ships as a custom element the same way
  K7Card.svelte does: a Card shell (imported as a plain Svelte component, per
  Card.svelte's own note about not slotting across two shadow roots) wrapping
  presets / running readout / finished state.

  Card state mapping: idle -> idle, running -> ok, finished -> warn (a
  finished timer is not an error, so it never reaches `fail`).
-->
<svelte:options
  customElement={{
    tag: 'k7-timer',
    props: {
      presets: { reflect: true },
      soundOnComplete: { reflect: true }
    }
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'

  interface Props {
    /** Comma-separated whole minutes, e.g. "5,10,15,30". Custom-element attrs are strings. */
    presets?: string
    /** "true" / "false" — custom-element attrs are strings, not booleans. */
    soundOnComplete?: string
  }

  let { presets = '5,10,15,30', soundOnComplete = 'true' }: Props = $props()

  type Phase = 'idle' | 'running' | 'paused' | 'finished'

  let presetMinutes = $derived(
    presets
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  )
  let soundEnabled = $derived(soundOnComplete.trim().toLowerCase() !== 'false')

  let phase = $state<Phase>('idle')
  let totalSeconds = $state(0)
  let remainingSeconds = $state(0)
  let deadline = $state(0) // epoch ms, valid while running

  let cardState = $derived<'ok' | 'warn' | 'idle'>(
    phase === 'running' ? 'ok' : phase === 'finished' ? 'warn' : 'idle'
  )

  function format(seconds: number): string {
    const s = Math.max(0, Math.round(seconds))
    const mm = Math.floor(s / 60)
    const ss = s % 60
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }

  let readout = $derived(format(remainingSeconds))

  function beep(): void {
    if (!soundEnabled) return
    // Safari blocks audio without a user gesture, and on a kiosk that has been
    // idle for a while there may be no fresh gesture at all — a thrown error
    // here must never break the card.
    try {
      const AudioCtx =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
      osc.onended = () => {
        try {
          ctx.close()
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* Safari without a user gesture, or no Web Audio at all — silent no-op. */
    }
  }

  function start(minutes: number): void {
    totalSeconds = minutes * 60
    remainingSeconds = totalSeconds
    deadline = Date.now() + totalSeconds * 1000
    phase = 'running'
  }

  function pause(): void {
    if (phase !== 'running') return
    remainingSeconds = Math.max(0, Math.round((deadline - Date.now()) / 1000))
    phase = 'paused'
  }

  function resume(): void {
    if (phase !== 'paused') return
    deadline = Date.now() + remainingSeconds * 1000
    phase = 'running'
  }

  function reset(): void {
    phase = 'idle'
    totalSeconds = 0
    remainingSeconds = 0
    deadline = 0
  }

  $effect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => {
      const left = Math.round((deadline - Date.now()) / 1000)
      if (left <= 0) {
        remainingSeconds = 0
        phase = 'finished'
        beep()
      } else {
        remainingSeconds = left
      }
    }, 250)
    // Torn down whenever `phase` changes (pause/reset/finish) and on unmount —
    // an interval left running on a display that stays on for months is a
    // real leak, not a theoretical one.
    return () => clearInterval(id)
  })
</script>

<Card label="MINUTNIK" state={cardState}>
  {#if phase === 'idle'}
    <div class="presets">
      {#each presetMinutes as minutes (minutes)}
        <button type="button" class="btn-ghost preset" onclick={() => start(minutes)}>
          {minutes} min
        </button>
      {/each}
    </div>
  {:else}
    <div class="readout" class:finished={phase === 'finished'}>{readout}</div>
  {/if}

{#snippet actions()}
  {#if phase === 'running'}
    <div class="controls">
      <button type="button" class="btn-ghost" onclick={pause}>pauza</button>
      <button type="button" class="btn-ghost" onclick={reset}>reset</button>
    </div>
  {:else if phase === 'paused'}
    <div class="controls">
      <button type="button" class="btn-solid" onclick={resume}>wznów</button>
      <button type="button" class="btn-ghost" onclick={reset}>reset</button>
    </div>
  {:else if phase === 'finished'}
    <div class="controls">
      <button type="button" class="btn-ghost" onclick={reset}>reset</button>
    </div>
  {/if}
{/snippet}
</Card>

<style>
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-content: flex-start;
    height: 100%;
  }

  .controls {
    display: flex;
    gap: var(--space-2);
  }

  /* Glance tier: read from the doorway, mm:ss with tabular numerals so the
     digits don't shuffle width every second. */
  .readout {
    display: flex;
    align-items: center;
    height: 100%;
    font-size: var(--glance-md);
    line-height: var(--leading-glance);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-glance);
    color: var(--fg);
  }

  /* Finished state borrows warn's colour so the readout itself, not only the
     card badge, tells the story from across the room. Colour still never
     carries the state alone — the card badge glyph [!] is the real carrier. */
  .readout.finished {
    color: var(--warn);
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

  /* At most one solid amber control per card (DESIGN.md §2/§8) — reserved for
     "wznów" (resume), the card's single primary action while paused. */
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
  /* Hover raises contrast, never lowers it — never --fg-muted on hover. */
  .btn-ghost:hover {
    background: var(--ghost-hover);
    color: var(--fg);
  }
  .btn-ghost:active {
    background: var(--ghost-active);
  }

  .preset {
    flex: 0 0 auto;
  }

  button:disabled {
    color: var(--fg-disabled);
    cursor: not-allowed;
  }

  /* :focus-visible is Safari 15.4+; ship a plain :focus fallback for 15.0 and
     reset it once :focus-visible is actually supported. */
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
    button {
      transition-duration: 0ms;
    }
  }
</style>
