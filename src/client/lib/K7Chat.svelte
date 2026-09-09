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

  const showMic = $derived(voiceInput === 'true')

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
              <span class="content">{m.content}</span>
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
        <button type="button" class="btn-ghost mic" disabled title="transkrypcja audio — wkrótce" aria-label="nagrywanie glosowe (niedostepne)">
          [MIC]
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

  .content {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: var(--text-sm);
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
    padding: 0 var(--control-pad-x);
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
    padding: 0 var(--control-pad-x);
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
