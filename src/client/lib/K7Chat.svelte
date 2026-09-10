<!--
  AI chat card. Ships as a custom element (k7-chat) wrapping the shared
  <Card> shell.

  The model picker, budgeting knobs and the mic affordance all come straight
  from the chat card's params contract (docs/handoff/layout.schema.yaml
  params.chat) — this component never invents its own defaults for them
  beyond the schema's own.

  There is no EventSource here: the turn endpoint is a POST (the message body
  has to go somewhere), and EventSource cannot carry one, so the SSE frames
  are read by hand off `fetch(...).body`. The exact same splitting logic is
  re-implemented server-side (upstream/kilo.ts, reading the gateway's own SSE)
  — genuinely two different environments (a Node Response body vs. a browser
  fetch reader), not a copy-paste that should be pulled into one shared module
  across the client/server boundary.
-->
<svelte:options
  customElement={{
    tag: 'k7-chat',
    props: {
      defaultModel: { type: 'String', reflect: true },
      availableModels: { type: 'String', reflect: true },
      contextWindowMarginPercent: { type: 'String', reflect: true },
      compactingThresholdPercent: { type: 'String', reflect: true },
      voiceInput: { type: 'String', reflect: true },
    },
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'
  import { renderMarkdown } from './markdown.ts'

  interface GatewayModelOption {
    id: string
    name: string
    pricing: { promptUsdPerToken: number; completionUsdPerToken: number } | null
  }

  interface ChatMessageView {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
  }

  interface Props {
    defaultModel?: string
    /** JSON-encoded string[]. Empty/absent = fetch the list from /api/gateway/models. */
    availableModels?: string
    contextWindowMarginPercent?: string
    compactingThresholdPercent?: string
    voiceInput?: string
  }

  let {
    defaultModel = 'kilo-auto/free',
    availableModels = '',
    contextWindowMarginPercent = '20',
    compactingThresholdPercent = '80',
    voiceInput = 'false',
  }: Props = $props()

  // Checked once, not reactively: whether the browser can record at all
  // never changes mid-session. A kiosk on Safari 15 must never show a mic
  // button it cannot back up — see K7Audiometer.svelte's identical
  // "never render a dead control" discipline for microphone permission,
  // applied here to microphone *support*.
  const mediaSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'

  const showMic = $derived(voiceInput === 'true' && mediaSupported)

  type MicPhase = 'idle' | 'pending' | 'recording' | 'transcribing'
  let micPhase = $state<MicPhase>('idle')

  let micStream: MediaStream | undefined
  let micRecorder: MediaRecorder | undefined

  /** First `MediaRecorder`-supported type wins; Safari does not reliably
   *  support WebM the way Chromium does, so nothing here is hardcoded. */
  function pickRecorderMimeType(): string | undefined {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2']
    return candidates.find((t) => MediaRecorder.isTypeSupported(t))
  }

  function teardownMic(): void {
    if (micRecorder && micRecorder.state !== 'inactive') {
      try {
        micRecorder.stop()
      } catch {
        /* already stopped */
      }
    }
    micRecorder = undefined
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop()
      micStream = undefined
    }
  }

  function micErrorMessage(err: unknown): string {
    const name = (err as { name?: string })?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'odmowa dostepu do mikrofonu'
    if (name === 'NotFoundError') return 'brak mikrofonu'
    return 'blad nagrywania'
  }

  async function startRecording(): Promise<void> {
    micPhase = 'pending'
    failed = false
    errorText = ''
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickRecorderMimeType()
      const recorder = mimeType ? new MediaRecorder(micStream, { mimeType }) : new MediaRecorder(micStream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        // teardownMic() (unmount, or a fresh startRecording superseding this
        // one) clears `micRecorder` synchronously before this event fires —
        // if it no longer matches, this recorder was torn down and must not
        // kick off a stray network call.
        if (micRecorder !== recorder) return
        // The stream must stay alive until the recorder has actually
        // finished flushing its last chunk (onstop fires after that) —
        // stopping tracks any earlier can truncate the final chunk. Released
        // here, immediately after, and always before the network call.
        if (micStream) {
          for (const track of micStream.getTracks()) track.stop()
          micStream = undefined
        }
        void transcribe(new Blob(chunks, { type: recorder.mimeType || mimeType || 'application/octet-stream' }))
      }
      micRecorder = recorder
      recorder.start()
      micPhase = 'recording'
    } catch (err) {
      teardownMic()
      micPhase = 'idle'
      failed = true
      errorText = micErrorMessage(err)
    }
  }

  function stopRecording(): void {
    micRecorder?.stop()
  }

  async function transcribe(blob: Blob): Promise<void> {
    micRecorder = undefined
    micPhase = 'transcribing'
    try {
      const res = await fetch('/api/chat/transcribe', {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        body: blob,
      })
      if (!res.ok) throw new Error(`transcribe ${res.status}`)
      const body = (await res.json()) as { text?: string }
      // Populates the compose field for review — never auto-sent.
      if (typeof body.text === 'string' && body.text.trim() !== '') {
        input = body.text.trim()
      }
    } catch (err) {
      failed = true
      errorText = (err as Error).message || 'transkrypcja nieudana'
    } finally {
      micPhase = 'idle'
    }
  }

  function onMicClick(): void {
    if (micPhase === 'idle') void startRecording()
    else if (micPhase === 'recording') stopRecording()
    // 'pending'/'transcribing': button is disabled, nothing to do.
  }

  // Bracket-glyph convention: every state carries text, not just colour.
  const micLabel = $derived(
    micPhase === 'recording'
      ? '[* REC]'
      : micPhase === 'pending'
        ? '[MIC...]'
        : micPhase === 'transcribing'
          ? '[...]'
          : '[MIC]',
  )
  const micAriaLabel = $derived(
    micPhase === 'recording'
      ? 'zatrzymaj nagrywanie'
      : micPhase === 'pending'
        ? 'oczekiwanie na zgode mikrofonu'
        : micPhase === 'transcribing'
          ? 'trwa transkrypcja'
          : 'rozpocznij nagrywanie glosowe',
  )

  let models = $state<GatewayModelOption[]>([])
  // Deliberately captures only the initial value: once the household picks a
  // model mid-conversation it should stay picked, not snap back if the
  // layout's defaultModel attribute is ever changed live.
  // svelte-ignore state_referenced_locally
  let selectedModel = $state(defaultModel)
  let conversationId = $state<string | undefined>(undefined)
  let messages = $state<ChatMessageView[]>([])
  let input = $state('')
  let streaming = $state(false)
  let failed = $state(false)
  let errorText = $state('')
  let costToday = $state<number | undefined>(undefined)

  let cardState = $derived<'ok' | 'fail' | 'idle'>(failed ? 'fail' : streaming ? 'idle' : messages.length > 0 ? 'ok' : 'idle')
  let meta = $derived(
    costToday === undefined ? selectedModel : `${selectedModel} | dziś: $${costToday.toFixed(4)}`,
  )

  function parseAvailableModels(raw: string): GatewayModelOption[] {
    try {
      const ids = JSON.parse(raw) as unknown
      if (!Array.isArray(ids)) return []
      return ids.filter((id): id is string => typeof id === 'string').map((id) => ({ id, name: id, pricing: null }))
    } catch {
      return []
    }
  }

  async function loadModels(signal: AbortSignal): Promise<void> {
    const fromParams = parseAvailableModels(availableModels)
    if (fromParams.length > 0) {
      models = fromParams
      return
    }
    try {
      const res = await fetch('/api/gateway/models', { signal })
      if (!res.ok) throw new Error(`models ${res.status}`)
      models = (await res.json()) as GatewayModelOption[]
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Not fatal: the select falls back to just the configured default.
      models = [{ id: defaultModel, name: defaultModel, pricing: null }]
    }
  }

  async function loadCostToday(signal: AbortSignal): Promise<void> {
    try {
      const res = await fetch('/api/chat/cost-history?days=1', { signal })
      if (!res.ok) return
      const body = (await res.json()) as { totals: { costUsd: number } }
      costToday = body.totals.costUsd
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Cost visibility is a nicety, not core to the card working — leave
      // costToday as-is rather than failing the whole card over it.
    }
  }

  async function ensureConversation(signal: AbortSignal): Promise<string> {
    if (conversationId) return conversationId
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: selectedModel }),
      signal,
    })
    if (!res.ok) throw new Error(`conversation create ${res.status}`)
    const created = (await res.json()) as { id: string }
    conversationId = created.id
    return created.id
  }

  /** One `event: X\ndata: Y` frame, matching what routes/chat.ts writes. */
  function parseFrame(frame: string): { event?: string; data?: string } {
    let event: string | undefined
    let data: string | undefined
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
      else if (line.startsWith('data:')) data = line.slice('data:'.length).trim()
    }
    return { event, data }
  }

  let controller: AbortController | undefined

  // Local, ephemeral view ids for Svelte's #each keying only — never sent to
  // the server or persisted. `crypto.randomUUID()` is Safari 15.4+, past this
  // project's 15.0 compile floor, so a plain counter is used instead.
  let nextViewId = 0
  function viewId(): string {
    nextViewId += 1
    return `v${nextViewId}`
  }

  async function send(): Promise<void> {
    const content = input.trim()
    if (!content || streaming) return
    input = ''
    failed = false
    errorText = ''

    controller?.abort()
    const ac = new AbortController()
    controller = ac

    // Shown immediately: unlike the shopping list's toggle (which can race
    // another device), a chat turn has exactly one author typing into their
    // own card, so there is nothing for a server-confirmed echo to protect
    // against — every chat UI shows what you just typed before the network
    // round-trip completes.
    messages = [...messages, { id: viewId(), role: 'user', content }]
    const assistantMessageId = viewId()
    messages = [...messages, { id: assistantMessageId, role: 'assistant', content: '' }]

    streaming = true
    try {
      const id = await ensureConversation(ac.signal)
      const res = await fetch(`/api/chat/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          contextWindowMarginPercent: Number(contextWindowMarginPercent),
          compactingThresholdPercent: Number(compactingThresholdPercent),
        }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) throw new Error(`chat ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const frame of parts) {
          const { event, data } = parseFrame(frame)
          if (!event || data === undefined) continue
          const payload = JSON.parse(data) as { content?: string; error?: string }
          if (event === 'delta' && payload.content) {
            messages = messages.map((m) => (m.id === assistantMessageId ? { ...m, content: m.content + payload.content } : m))
          } else if (event === 'error') {
            failed = true
            errorText = payload.error ?? 'nieznany blad'
          }
        }
      }
      failed = false
      void loadCostToday(ac.signal)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      failed = true
      errorText = (err as Error).message
    } finally {
      if (controller === ac) streaming = false
    }
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault()
    void send()
  }

  $effect(() => {
    const ac = new AbortController()
    void loadModels(ac.signal)
    void loadCostToday(ac.signal)
    return () => {
      ac.abort()
      controller?.abort()
      // A card that can be destroyed and recreated (theme/layout reload)
      // must not leak an open microphone — same discipline as
      // K7Audiometer.svelte's teardown.
      teardownMic()
    }
  })
</script>

<Card label="CZAT.AI" {meta} state={cardState}>
  <div class="wrap">
    <select class="model-picker" bind:value={selectedModel} disabled={streaming || conversationId !== undefined}>
      {#each models as m (m.id)}
        <option value={m.id}>{m.name}</option>
      {/each}
      {#if models.length === 0}
        <option value={selectedModel}>{selectedModel}</option>
      {/if}
    </select>

    <div class="log" role="log">
      {#if messages.length === 0}
        <p class="empty">rozpocznij rozmowe</p>
      {:else}
        {#each messages as m (m.id)}
          {#if m.content || streaming}
            <p class="line line-{m.role}">
              <span class="who">{m.role === 'user' ? 'ty' : m.role === 'assistant' ? 'ai' : 'sys'}</span>
              <!-- renderMarkdown escapes every character before generating any tag (see
                   lib/markdown.ts) — this is not raw model/user output reaching the DOM. -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="content">{@html renderMarkdown(m.content)}</span>
            </p>
          {/if}
        {/each}
      {/if}
      {#if failed}
        <p class="stale">[!] {errorText || 'wiadomosc nie zostala wyslana'}</p>
      {/if}
    </div>

    <form class="composer" onsubmit={onSubmit}>
      {#if showMic}
        <button
          type="button"
          class="btn-ghost mic"
          class:recording={micPhase === 'recording'}
          disabled={micPhase === 'pending' || micPhase === 'transcribing'}
          onclick={onMicClick}
          aria-label={micAriaLabel}
        >
          {micLabel}
        </button>
      {/if}
      <input
        class="input"
        type="text"
        placeholder="napisz wiadomosc"
        bind:value={input}
        maxlength="4000"
        disabled={streaming}
      />
      <button type="submit" class="btn-solid" disabled={streaming || input.trim() === ''}>wyslij</button>
    </form>
  </div>
</Card>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: var(--space-3);
  }

  .model-picker {
    flex: 0 0 auto;
    min-height: var(--control-h-sm);
    padding: 0 var(--control-pad-x);
    background: var(--surface);
    color: var(--fg);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .log {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .empty {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-sm);
  }

  .line {
    margin: 0;
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }

  .who {
    flex: 0 0 auto;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
    min-width: 2.5em;
  }

  .line-assistant .who { color: var(--signal); }

  /* Markdown-rendered (see lib/markdown.ts) — line breaks come from the <p>/
     <br> the renderer emits, not from CSS, so no white-space: pre-wrap here. */
  .content {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--text-sm);
  }

  .content :global(p) {
    margin: 0 0 var(--space-2);
  }
  .content :global(p:last-child) {
    margin-bottom: 0;
  }

  .content :global(ul),
  .content :global(ol) {
    margin: 0 0 var(--space-2);
    padding-left: var(--space-4);
  }
  .content :global(ul:last-child),
  .content :global(ol:last-child) {
    margin-bottom: 0;
  }

  .content :global(code) {
    font-family: var(--font-mono);
    background: var(--surface-sunken);
    border-radius: var(--radius);
    padding: 0 0.25em;
  }

  .content :global(pre) {
    margin: 0 0 var(--space-2);
    padding: var(--space-2);
    background: var(--surface-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    overflow-x: auto;
  }
  .content :global(pre code) {
    background: none;
    padding: 0;
  }

  .content :global(a) {
    color: var(--signal);
  }

  .stale { margin: 0; color: var(--warn); font-size: var(--text-sm); }

  .composer {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
  }

  .input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--control-h);
    padding: 0 var(--control-pad-x);
    background: var(--surface);
    color: var(--fg);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-ui);
    font-size: var(--text-base);
  }

  .input:disabled { color: var(--fg-disabled); }

  /* At most one solid amber control per card — reserved for "wyslij", the
     card's single primary action. */
  .btn-solid {
    flex: 0 0 auto;
    min-height: var(--control-h);
    /* DESIGN.md §6: "buttons pad vertically" — min-height alone leaves a
       two-line label touching the border. */
    padding: var(--space-2) var(--control-pad-x);
    background: var(--accent);
    color: var(--accent-fg);
    border: var(--border-w-strong) solid var(--accent);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .btn-solid:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .btn-solid:active { background: var(--accent-active); border-color: var(--accent-active); }
  .btn-solid:disabled {
    background: transparent;
    border-color: var(--border);
    color: var(--fg-disabled);
    cursor: not-allowed;
  }

  .btn-ghost {
    flex: 0 0 auto;
    min-height: var(--control-h);
    /* DESIGN.md §6: "buttons pad vertically" — min-height alone leaves a
       two-line label touching the border. */
    padding: var(--space-2) var(--control-pad-x);
    background: transparent;
    color: var(--fg);
    border: var(--border-w-strong) solid var(--border-strong);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .btn-ghost:hover { background: var(--ghost-hover); }
  .btn-ghost:active { background: var(--ghost-active); }
  .btn-ghost:disabled {
    color: var(--fg-disabled);
    border-color: var(--border);
    cursor: not-allowed;
  }

  /* Recording state: colour never carries this alone — the label itself
     switches to "[* REC]" (see micLabel). Opacity-only animation per the
     A8X per-frame-cost budget — never box-shadow/filter. */
  .mic.recording {
    color: var(--warn);
    border-color: var(--warn);
    animation: mic-pulse 1s ease-in-out infinite;
  }
  @keyframes mic-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .mic.recording { animation: none; }
  }

  button:focus,
  .input:focus,
  .model-picker:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    button:focus:not(:focus-visible),
    .input:focus:not(:focus-visible),
    .model-picker:focus:not(:focus-visible) {
      outline: none;
    }
  }
</style>
