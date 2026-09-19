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

  k7-chat-harness added the rest of the card around the thread:
  - ARCHIWUM lists past threads (always persisted, never reachable before);
    NOWA / `/clear` starts a fresh context and leaves the old one there. The
    thread this device last had open is resumed after a reload.
  - `/commands` (lib/chat-commands.ts holds everything testable about them).
    Output they produce is a `local` line: shown here, never sent to the
    model, never persisted — `k7` in the log, not `ai`.
  - Other cards are reached only through lib/k7-events.ts broadcasts: the
    timer, the recipes card's review form, the shopping list.
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
      weatherLat: { type: 'String', reflect: true },
      weatherLon: { type: 'String', reflect: true },
      weatherUnits: { type: 'String', reflect: true },
    },
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'
  import { renderMarkdown } from './markdown.ts'
  import {
    formatContextReport,
    formatDuration,
    fridgePrompt,
    helpText,
    linkDurations,
    matchCommands,
    parseDuration,
    parseInput,
    parseServings,
    portionsPrompt,
    titleFrom,
    weatherPrompt,
    type ChatCommand,
    type ContextReport,
    type WeatherSnapshot,
  } from './chat-commands.ts'
  import { announceShoppingListChanged, offerRecipeDraft, requestTimerStart, type RecipeDraft } from './k7-events.ts'

  interface GatewayModelOption {
    id: string
    name: string
    pricing: { promptUsdPerToken: number; completionUsdPerToken: number } | null
  }

  interface PickItem {
    label: string
    checked: boolean
    /** Already an unchecked line on the shopping list — offered unticked. */
    onList: boolean
  }

  interface ShoppingPick {
    items: PickItem[]
    phase: 'open' | 'adding' | 'done'
    note: string
  }

  interface ChatMessageView {
    id: string
    /** `local`: produced by a command on this device — never sent, never stored. */
    role: 'user' | 'assistant' | 'system' | 'local'
    content: string
    /** The persisted Message id, when there is one (history, or a finished turn). */
    serverId?: string
    pick?: ShoppingPick
  }

  interface ConversationSummary {
    id: string
    title: string | null
    model: string
    updatedAt: string
  }

  interface Props {
    defaultModel?: string
    /** JSON-encoded string[]. Empty/absent = fetch the list from /api/gateway/models. */
    availableModels?: string
    contextWindowMarginPercent?: string
    compactingThresholdPercent?: string
    voiceInput?: string
    /** The first weather card's location, passed by main.ts, so /pogoda asks about the same place the wall shows. */
    weatherLat?: string
    weatherLon?: string
    weatherUnits?: string
  }

  let {
    defaultModel = 'kilo-auto/free',
    availableModels = '',
    contextWindowMarginPercent = '20',
    compactingThresholdPercent = '80',
    voiceInput = 'false',
    weatherLat = '',
    weatherLon = '',
    weatherUnits = '',
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
  /** A command waiting on the network (an extraction, a report) — one at a time, like a turn. */
  let working = $state(false)
  let failed = $state(false)
  let errorText = $state('')
  let costToday = $state<number | undefined>(undefined)

  type View = 'chat' | 'archive'
  let view = $state<View>('chat')
  let archive = $state<ConversationSummary[]>([])
  let archiveLoading = $state(false)
  let archiveFailed = $state(false)
  /** First tap on × arms this row; the second deletes. A kitchen wall gets brushed against. */
  let confirmDeleteId = $state<string | undefined>(undefined)

  let busy = $derived(streaming || working)
  let cardState = $derived<'ok' | 'fail' | 'idle'>(failed ? 'fail' : busy ? 'idle' : messages.length > 0 ? 'ok' : 'idle')
  let meta = $derived(
    costToday === undefined ? selectedModel : `${selectedModel} | dziś: $${costToday.toFixed(4)}`,
  )
  let chips = $derived(matchCommands(input))

  let inputEl = $state<HTMLInputElement | undefined>(undefined)

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
      // A thread resumed before this list arrived keeps its model visible.
      ensureModelOption(selectedModel)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Not fatal: the select falls back to just the configured default.
      models = [{ id: defaultModel, name: defaultModel, pricing: null }]
      ensureModelOption(selectedModel)
    }
  }

  /** A resumed thread may use a model the list no longer offers; the select must still show it. */
  function ensureModelOption(id: string): void {
    if (!models.some((m) => m.id === id)) models = [...models, { id, name: id, pricing: null }]
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

  // ------------------------------------------------------------ the thread

  /**
   * Per device, not per household: two people chatting from the wall and a
   * phone each come back to their own thread. Storage can be off (private
   * mode, a locked-down kiosk) — then the card just starts fresh, as before.
   */
  const CONVERSATION_KEY = 'k7:chat-conversation'

  function rememberConversation(id: string | undefined): void {
    try {
      if (id) localStorage.setItem(CONVERSATION_KEY, id)
      else localStorage.removeItem(CONVERSATION_KEY)
    } catch {
      /* no storage — nothing to resume next time, which is the old behaviour */
    }
  }

  function storedConversation(): string | undefined {
    try {
      return localStorage.getItem(CONVERSATION_KEY) ?? undefined
    } catch {
      return undefined
    }
  }

  async function ensureConversation(signal: AbortSignal, title: string): Promise<string> {
    if (conversationId) return conversationId
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, title }),
      signal,
    })
    if (!res.ok) throw new Error(`conversation create ${res.status}`)
    const created = (await res.json()) as { id: string }
    conversationId = created.id
    rememberConversation(created.id)
    return created.id
  }

  const COMPACT_PREFIX = '[COMPACT] '

  function viewOf(m: { id: string; role: 'user' | 'assistant' | 'system'; content: string }): ChatMessageView {
    const content = m.role === 'system' && m.content.startsWith(COMPACT_PREFIX) ? m.content.slice(COMPACT_PREFIX.length) : m.content
    return { id: viewId(), serverId: m.id, role: m.role, content }
  }

  /** Loads a thread from the archive (or the one this device last had open). Quiet = a failed resume just starts fresh. */
  async function openConversation(id: string, quiet = false): Promise<void> {
    working = true
    try {
      const [convRes, msgRes] = await Promise.all([
        fetch(`/api/chat/conversations/${encodeURIComponent(id)}`),
        fetch(`/api/chat/conversations/${encodeURIComponent(id)}/messages`),
      ])
      if (convRes.status === 404 || msgRes.status === 404) {
        if (storedConversation() === id) rememberConversation(undefined)
        if (!quiet) addLocal('[!] tej rozmowy juz nie ma')
        return
      }
      if (!convRes.ok || !msgRes.ok) throw new Error(`conversation ${convRes.status}/${msgRes.status}`)
      const conversation = (await convRes.json()) as { id: string; model: string }
      const history = (await msgRes.json()) as { id: string; role: 'user' | 'assistant' | 'system'; content: string }[]
      controller?.abort()
      conversationId = conversation.id
      ensureModelOption(conversation.model)
      selectedModel = conversation.model
      messages = history.map(viewOf)
      failed = false
      errorText = ''
      view = 'chat'
      rememberConversation(conversation.id)
    } catch (err) {
      if (!quiet) {
        failed = true
        errorText = (err as Error).message
      }
    } finally {
      working = false
    }
  }

  function startNewConversation(): void {
    controller?.abort()
    streaming = false
    const had = conversationId !== undefined
    conversationId = undefined
    messages = []
    failed = false
    errorText = ''
    view = 'chat'
    rememberConversation(undefined)
    if (had) addLocal('> nowa rozmowa // poprzednia jest w archiwum')
  }

  async function switchModel(id: string): Promise<boolean> {
    if (id === selectedModel) return true
    if (conversationId) {
      try {
        const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: id }),
        })
        if (!res.ok) throw new Error(`model ${res.status}`)
      } catch {
        addLocal('[!] nie udalo sie zmienic modelu')
        return false
      }
    }
    selectedModel = id
    return true
  }

  function onModelPicked(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement
    const id = select.value
    void switchModel(id).then((ok) => {
      if (ok && conversationId) addLocal(`[OK] model: ${id} // od nastepnej wiadomosci`)
      // Put the select back on what is actually in effect.
      if (!ok) select.value = selectedModel
    })
  }

  // ------------------------------------------------------------ archive

  async function openArchive(): Promise<void> {
    view = 'archive'
    confirmDeleteId = undefined
    archiveLoading = true
    try {
      const res = await fetch('/api/chat/conversations?limit=50')
      if (!res.ok) throw new Error(`archive ${res.status}`)
      archive = (await res.json()) as ConversationSummary[]
      archiveFailed = false
    } catch {
      archiveFailed = true
    } finally {
      archiveLoading = false
    }
  }

  let confirmTimer: ReturnType<typeof setTimeout> | undefined

  async function deleteConversation(id: string): Promise<void> {
    if (confirmDeleteId !== id) {
      confirmDeleteId = id
      clearTimeout(confirmTimer)
      confirmTimer = setTimeout(() => {
        confirmDeleteId = undefined
      }, 4000)
      return
    }
    confirmDeleteId = undefined
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`)
      archive = archive.filter((c) => c.id !== id)
      if (id === conversationId) {
        conversationId = undefined
        messages = []
        rememberConversation(undefined)
      }
      archiveFailed = false
    } catch {
      archiveFailed = true
    }
  }

  const stamp = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const whenLabel = (iso: string): string => stamp.format(new Date(iso))

  // ------------------------------------------------------------ the log

  // Local, ephemeral view ids for Svelte's #each keying only — never sent to
  // the server or persisted. `crypto.randomUUID()` is Safari 15.4+, past this
  // project's 15.0 compile floor, so a plain counter is used instead.
  let nextViewId = 0
  function viewId(): string {
    nextViewId += 1
    return `v${nextViewId}`
  }

  function addLocal(content: string, pick?: ShoppingPick): string {
    const id = viewId()
    messages = [...messages, { id, role: 'local', content, ...(pick ? { pick } : {}) }]
    return id
  }

  function updateLocal(id: string, patch: Partial<Pick<ChatMessageView, 'content' | 'pick'>>): void {
    messages = messages.map((m) => (m.id === id ? { ...m, ...patch } : m))
  }

  let logEl = $state<HTMLDivElement | undefined>(undefined)

  // Keep the newest line in view as the thread grows or streams.
  $effect(() => {
    void messages
    const el = logEl
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight))
  })

  function timerResultText(seconds: number): string {
    const result = requestTimerStart(seconds)
    if (result === 'started') return `[OK] minutnik: ${formatDuration(seconds)}`
    if (result === 'busy') return '[!] minutnik juz odlicza — zatrzymaj go najpierw'
    return '[!] brak minutnika w ukladzie'
  }

  /** Delegated: the duration buttons are generated HTML inside rendered markdown (chat-commands.ts linkDurations). */
  function onLogClick(e: MouseEvent): void {
    const button = (e.target as HTMLElement).closest('button.dur')
    const seconds = Number(button?.getAttribute('data-seconds'))
    if (!button || !Number.isFinite(seconds) || seconds <= 0) return
    addLocal(timerResultText(seconds))
  }

  // ------------------------------------------------------------ a turn

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

  /** `title` names a thread this turn creates — the display text, not an expanded template. */
  async function send(content: string, title: string = titleFrom(content)): Promise<void> {
    if (!content || busy) return
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
      const id = await ensureConversation(ac.signal, title)
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}/messages`, {
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
          const payload = JSON.parse(data) as { content?: string; error?: string; message?: { id?: string } }
          if (event === 'delta' && payload.content) {
            messages = messages.map((m) => (m.id === assistantMessageId ? { ...m, content: m.content + payload.content } : m))
          } else if (event === 'done' && payload.message?.id) {
            // The persisted id — what /przepis names when it drafts from this answer.
            const serverId = payload.message.id
            messages = messages.map((m) => (m.id === assistantMessageId ? { ...m, serverId } : m))
          } else if (event === 'error') {
            failed = true
            errorText = payload.error ?? 'nieznany blad'
          }
        }
      }
      void loadCostToday(ac.signal)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      failed = true
      errorText = (err as Error).message
    } finally {
      if (controller === ac) streaming = false
    }
  }

  // ------------------------------------------------------------ commands

  const lastAssistant = (): ChatMessageView | undefined =>
    [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim() !== '')

  const DRAFT_FAILURES: Record<string, string> = {
    'no-assistant-message': '[!] brak odpowiedzi ai do przetworzenia',
    'not-a-recipe': '[!] w ostatniej odpowiedzi nie ma przepisu',
    'extraction-failed': '[!] nie udalo sie wyodrebnic przepisu — sprobuj ponownie',
    'no-such-conversation': '[!] tej rozmowy juz nie ma',
  }

  /** The /przepis extraction, shared by /zakupy. Undefined when it failed — the line already says why. */
  async function draftRecipe(lineId: string): Promise<RecipeDraft | undefined> {
    const last = lastAssistant()
    if (!conversationId || !last) {
      updateLocal(lineId, { content: DRAFT_FAILURES['no-assistant-message'] })
      return undefined
    }
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/recipe-draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(last.serverId ? { messageId: last.serverId } : {}),
      })
      const body = (await res.json()) as RecipeDraft | { error: string; reason?: string }
      if (!res.ok || 'error' in body) {
        const reason = 'reason' in body ? body.reason : undefined
        updateLocal(lineId, { content: (reason && DRAFT_FAILURES[reason]) || `[!] blad ${res.status}` })
        return undefined
      }
      return body
    } catch {
      updateLocal(lineId, { content: '[!] brak polaczenia z serwerem' })
      return undefined
    }
  }

  async function commandRecipe(): Promise<void> {
    const line = addLocal('> wyodrebniam przepis z ostatniej odpowiedzi...')
    const draft = await draftRecipe(line)
    if (!draft) return
    const result = offerRecipeDraft(draft)
    updateLocal(line, {
      content:
        result === 'opened'
          ? `[OK] „${draft.title}” otwarty do przegladu w BAZA.PRZEPISY — zapisz go tam`
          : result === 'busy'
            ? '[!] BAZA.PRZEPISY ma otwarty inny przepis do przegladu — dokoncz go i sprobuj ponownie'
            : '[!] brak karty przepisow w ukladzie',
    })
  }

  const sameItem = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

  async function commandShopping(): Promise<void> {
    const line = addLocal('> wyodrebniam skladniki z ostatniej odpowiedzi...')
    const draft = await draftRecipe(line)
    if (!draft) return
    if (draft.ingredients.length === 0) {
      updateLocal(line, { content: '[!] brak skladnikow w ostatniej odpowiedzi' })
      return
    }
    // What is already on the list is offered unticked, not hidden — "2 jajka"
    // on the list may not cover "4 jajka" in the recipe; the household decides.
    let onList: string[] = []
    try {
      const res = await fetch('/api/shopping-list')
      if (res.ok) onList = ((await res.json()) as { label: string }[]).map((i) => i.label)
    } catch {
      /* the pick list works without the comparison */
    }
    const items = draft.ingredients.map((label) => {
      const already = onList.some((l) => sameItem(l, label))
      return { label, checked: !already, onList: already }
    })
    updateLocal(line, {
      content: `> skladniki: ${draft.title} // odznacz to, co masz`,
      pick: { items, phase: 'open', note: '' },
    })
  }

  function togglePick(lineId: string, index: number): void {
    messages = messages.map((m) => {
      if (m.id !== lineId || !m.pick || m.pick.phase !== 'open') return m
      const items = m.pick.items.map((it, i) => (i === index ? { ...it, checked: !it.checked } : it))
      return { ...m, pick: { ...m.pick, items } }
    })
  }

  async function addPicked(lineId: string): Promise<void> {
    const line = messages.find((m) => m.id === lineId)
    if (!line?.pick || line.pick.phase !== 'open') return
    const chosen = line.pick.items.filter((it) => it.checked)
    if (chosen.length === 0) return
    updateLocal(lineId, { pick: { ...line.pick, phase: 'adding', note: '' } })
    // One at a time, so a partial failure can say exactly how many landed.
    let added = 0
    for (const item of chosen) {
      try {
        const res = await fetch('/api/shopping-list', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: item.label }),
        })
        if (res.ok) added += 1
      } catch {
        /* counted as not added */
      }
    }
    if (added > 0) announceShoppingListChanged()
    const current = messages.find((m) => m.id === lineId)?.pick ?? line.pick
    updateLocal(lineId, {
      pick: {
        ...current,
        phase: 'done',
        note:
          added === chosen.length
            ? `[OK] dodano ${added} do LISTA.ZAKUPY`
            : `[!] dodano ${added} z ${chosen.length} — reszta nie trafila na liste`,
      },
    })
  }

  function cancelPick(lineId: string): void {
    const line = messages.find((m) => m.id === lineId)
    if (!line?.pick) return
    updateLocal(lineId, { pick: { ...line.pick, phase: 'done', note: '[--] anulowano' } })
  }

  async function commandWeather(question: string): Promise<void> {
    const params = [
      weatherLat ? `lat=${encodeURIComponent(weatherLat)}` : '',
      weatherLon ? `lon=${encodeURIComponent(weatherLon)}` : '',
      weatherUnits ? `units=${encodeURIComponent(weatherUnits)}` : '',
    ]
      .filter(Boolean)
      .join('&')
    working = true
    let weather: WeatherSnapshot
    try {
      const res = await fetch(`/api/weather${params ? `?${params}` : ''}`)
      if (!res.ok) throw new Error(`weather ${res.status}`)
      weather = (await res.json()) as WeatherSnapshot
    } catch {
      addLocal('[!] brak danych pogodowych')
      return
    } finally {
      working = false
    }
    await send(weatherPrompt(weather, question), question ? `pogoda: ${titleFrom(question, 50)}` : 'pogoda: wskazowki na dzis')
  }

  async function commandContext(): Promise<void> {
    const query = [
      `model=${encodeURIComponent(selectedModel)}`,
      conversationId ? `conversationId=${encodeURIComponent(conversationId)}` : '',
      `contextWindowMarginPercent=${encodeURIComponent(contextWindowMarginPercent)}`,
      `compactingThresholdPercent=${encodeURIComponent(compactingThresholdPercent)}`,
    ]
      .filter(Boolean)
      .join('&')
    try {
      const res = await fetch(`/api/chat/context?${query}`)
      if (!res.ok) throw new Error(`context ${res.status}`)
      addLocal(formatContextReport((await res.json()) as ContextReport))
    } catch {
      addLocal('[!] nie udalo sie odczytac kontekstu')
    }
  }

  async function commandModel(args: string): Promise<void> {
    if (!args) {
      const list = models.map((m) => (m.id === selectedModel ? `* ${m.id}` : `  ${m.id}`)).join('\n')
      addLocal(`> model: ${selectedModel}\n${list}\n/model nazwa — zmien`)
      return
    }
    const wanted = args.toLowerCase()
    const exact = models.find((m) => m.id.toLowerCase() === wanted)
    const matches = exact ? [exact] : models.filter((m) => m.id.toLowerCase().includes(wanted) || m.name.toLowerCase().includes(wanted))
    if (matches.length !== 1) {
      addLocal(
        matches.length === 0
          ? `[!] brak modelu „${args}” — /model pokaze liste`
          : `[!] „${args}” pasuje do kilku:\n${matches.slice(0, 12).map((m) => `  ${m.id}`).join('\n')}`,
      )
      return
    }
    const id = matches[0]!.id
    if (await switchModel(id)) addLocal(`[OK] model: ${id}${conversationId ? ' // od nastepnej wiadomosci' : ''}`)
  }

  async function commandCost(): Promise<void> {
    try {
      const [day, month] = await Promise.all(
        [1, 30].map(async (days) => {
          const res = await fetch(`/api/chat/cost-history?days=${days}`)
          if (!res.ok) throw new Error(`cost ${res.status}`)
          return ((await res.json()) as { totals: { calls: number; costUsd: number } }).totals
        }),
      )
      addLocal(
        `> koszt ai (szacunek)\ndzis:   $${day!.costUsd.toFixed(4)} // ${day!.calls} wywolan\n30 dni: $${month!.costUsd.toFixed(4)} // ${month!.calls} wywolan`,
      )
    } catch {
      addLocal('[!] nie udalo sie odczytac kosztow')
    }
  }

  async function commandTitle(args: string): Promise<void> {
    if (!conversationId) {
      addLocal('[!] brak rozmowy do nazwania — napisz cos najpierw')
      return
    }
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: args }),
      })
      if (!res.ok) throw new Error(`title ${res.status}`)
      const updated = (await res.json()) as { title: string | null }
      addLocal(`[OK] tytul: ${updated.title ?? '(brak)'}`)
    } catch {
      addLocal('[!] nie udalo sie zmienic tytulu')
    }
  }

  async function runCommand(command: ChatCommand, args: string): Promise<void> {
    if (command.argsRequired && !args) {
      addLocal(`[!] /${command.name} ${command.args ?? ''} — ${command.summary}`)
      return
    }
    switch (command.name) {
      case 'clear':
        startNewConversation()
        return
      case 'archiwum':
        await openArchive()
        return
      case 'pomoc':
        addLocal(helpText())
        return
      case 'minutnik': {
        const seconds = parseDuration(args)
        addLocal(seconds === undefined ? `[!] nie rozumiem czasu „${args}” — np. 10, 7:30, 90s, 1h 15min` : timerResultText(seconds))
        return
      }
      case 'porcje': {
        const servings = parseServings(args)
        if (servings === undefined) addLocal('[!] podaj liczbe porcji 1-50, np. /porcje 4')
        else if (!lastAssistant()) addLocal('[!] najpierw popros o przepis')
        else await send(portionsPrompt(servings))
        return
      }
      case 'lodowka':
        await send(fridgePrompt(args), `lodowka: ${titleFrom(args, 50)}`)
        return
      case 'pogoda':
        await commandWeather(args)
        return
      case 'tytul':
        await commandTitle(args)
        return
    }
    // The rest wait on the network with nothing streaming — one at a time.
    working = true
    try {
      if (command.name === 'przepis') await commandRecipe()
      else if (command.name === 'zakupy') await commandShopping()
      else if (command.name === 'context') await commandContext()
      else if (command.name === 'model') await commandModel(args)
      else if (command.name === 'koszt') await commandCost()
    } finally {
      working = false
    }
  }

  function submit(): void {
    if (busy) return
    const parsed = parseInput(input)
    if (parsed.kind === 'message') {
      if (!parsed.content) return
      input = ''
      void send(parsed.content)
      return
    }
    input = ''
    if (parsed.kind === 'unknown') {
      addLocal(`[!] nieznane polecenie /${parsed.name} — /pomoc pokaze liste`)
      return
    }
    void runCommand(parsed.command, parsed.args)
  }

  function onSubmit(e: SubmitEvent): void {
    e.preventDefault()
    submit()
  }

  function onChip(command: ChatCommand): void {
    if (command.argsRequired) {
      input = `/${command.name} `
      inputEl?.focus()
      return
    }
    if (busy) return
    input = ''
    void runCommand(command, '')
  }

  /** A sideways drag on the chip row scrolls the chips; it is not a page swipe (see K7Carousel). */
  const keepSwipe = (e: TouchEvent): void => e.stopPropagation()

  $effect(() => {
    const ac = new AbortController()
    void loadModels(ac.signal)
    void loadCostToday(ac.signal)
    const resume = storedConversation()
    if (resume) void openConversation(resume, true)
    return () => {
      ac.abort()
      controller?.abort()
      clearTimeout(confirmTimer)
      // A card that can be destroyed and recreated (theme/layout reload)
      // must not leak an open microphone — same discipline as
      // K7Audiometer.svelte's teardown.
      teardownMic()
    }
  })
</script>

<Card label="CZAT.AI" {meta} state={cardState}>
  {#snippet actions()}
    <div class="head-actions">
      {#if view === 'archive'}
        <button type="button" class="btn-ghost btn-sm" onclick={() => (view = 'chat')}>WROC</button>
      {:else}
        <button type="button" class="btn-ghost btn-sm" onclick={() => void openArchive()} disabled={busy}>ARCHIWUM</button>
      {/if}
      <button type="button" class="btn-ghost btn-sm" onclick={startNewConversation}>NOWA</button>
    </div>
  {/snippet}

  <div class="wrap">
    {#if view === 'archive'}
      <div class="archive" role="list">
        {#if archiveLoading && archive.length === 0}
          <p class="empty">wczytywanie</p>
        {:else if archive.length === 0}
          <p class="empty">{archiveFailed ? '[!] archiwum niedostepne' : 'brak zapisanych rozmow'}</p>
        {:else}
          {#each archive as c (c.id)}
            <div class="arch-row" role="listitem">
              <button type="button" class="arch-open" onclick={() => void openConversation(c.id)}>
                <span class="arch-title">{c.title ?? 'bez tytulu'}</span>
                <span class="arch-meta">
                  {#if c.id === conversationId}[AKTYWNA] {/if}{whenLabel(c.updatedAt)} // {c.model}
                </span>
              </button>
              <button
                type="button"
                class="arch-delete"
                class:armed={confirmDeleteId === c.id}
                aria-label={confirmDeleteId === c.id ? `potwierdz usuniecie: ${c.title ?? 'bez tytulu'}` : `usun: ${c.title ?? 'bez tytulu'}`}
                onclick={() => void deleteConversation(c.id)}
              >
                {confirmDeleteId === c.id ? 'USUN?' : '×'}
              </button>
            </div>
          {/each}
          {#if archiveFailed}<p class="stale">[!] operacja nieudana</p>{/if}
        {/if}
      </div>
    {:else}
      <select class="model-picker" value={selectedModel} onchange={onModelPicked} disabled={busy}>
        {#each models as m (m.id)}
          <option value={m.id}>{m.name}</option>
        {/each}
        {#if models.length === 0}
          <option value={selectedModel}>{selectedModel}</option>
        {/if}
      </select>

      <!-- The click lands on generated <button class="dur"> elements inside the
           rendered markdown, which are keyboard-operable on their own. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <div class="log" role="log" bind:this={logEl} onclick={onLogClick}>
        {#if messages.length === 0}
          <p class="empty">rozpocznij rozmowe // /pomoc pokaze polecenia</p>
        {:else}
          {#each messages as m (m.id)}
            {#if m.role === 'local'}
              <div class="line line-local">
                <span class="who">k7</span>
                <div class="content">
                  <pre class="local-text">{m.content}</pre>
                  {#if m.pick}
                    <ul class="pick">
                      {#each m.pick.items as item, i (i)}
                        <li>
                          <label class="pick-item" class:muted={!item.checked}>
                            <input
                              type="checkbox"
                              checked={item.checked}
                              disabled={m.pick.phase !== 'open'}
                              onchange={() => togglePick(m.id, i)}
                            />
                            <span>{item.label}{#if item.onList} <span class="pick-note">// juz na liscie</span>{/if}</span>
                          </label>
                        </li>
                      {/each}
                    </ul>
                    {#if m.pick.phase === 'done'}
                      <p class="local-text">{m.pick.note}</p>
                    {:else}
                      <div class="pick-actions">
                        <button
                          type="button"
                          class="btn-ghost btn-sm"
                          disabled={m.pick.phase !== 'open' || !m.pick.items.some((it) => it.checked)}
                          onclick={() => void addPicked(m.id)}
                        >
                          {m.pick.phase === 'adding' ? 'DODAJE...' : `DODAJ (${m.pick.items.filter((it) => it.checked).length})`}
                        </button>
                        <button type="button" class="btn-ghost btn-sm" disabled={m.pick.phase !== 'open'} onclick={() => cancelPick(m.id)}>
                          ANULUJ
                        </button>
                      </div>
                    {/if}
                  {/if}
                </div>
              </div>
            {:else if m.content || streaming}
              <p class="line line-{m.role}">
                <span class="who">{m.role === 'user' ? 'ty' : m.role === 'assistant' ? 'ai' : 'sys'}</span>
                <!-- renderMarkdown escapes every character before generating any tag (see
                     lib/markdown.ts), and linkDurations only wraps text between those tags
                     — this is not raw model/user output reaching the DOM. -->
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <span class="content">{@html m.role === 'assistant' ? linkDurations(renderMarkdown(m.content)) : renderMarkdown(m.content)}</span>
              </p>
            {/if}
          {/each}
        {/if}
        {#if failed}
          <p class="stale">[!] {errorText || 'wiadomosc nie zostala wyslana'}</p>
        {/if}
      </div>

      <div
        class="chips"
        role="group"
        aria-label="polecenia"
        ontouchstart={keepSwipe}
        ontouchmove={keepSwipe}
        ontouchend={keepSwipe}
      >
        {#each chips as c (c.name)}
          <button type="button" class="chip" title={c.summary} disabled={busy && !c.argsRequired} onclick={() => onChip(c)}>
            /{c.name}
          </button>
        {/each}
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
          placeholder="napisz wiadomosc albo /polecenie"
          bind:value={input}
          bind:this={inputEl}
          maxlength="4000"
          disabled={streaming}
        />
        <button type="submit" class="btn-solid" disabled={busy || input.trim() === ''}>wyslij</button>
      </form>
    {/if}
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

  .head-actions {
    display: flex;
    gap: var(--space-2);
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

  .log,
  .archive {
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

  /* Compaction summaries and command output: present, but quieter than the
     conversation itself. */
  .line-system .content,
  .line-local .content { color: var(--fg-muted); }

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

  /* Durations in an answer, generated by linkDurations — a text-rank button
     (DESIGN.md §8): dashed underline, no fill, raises contrast on hover. */
  .content :global(button.dur) {
    padding: 0 var(--space-1);
    background: transparent;
    border: none;
    border-bottom: var(--border-w) dashed var(--border-strong);
    border-radius: var(--radius);
    color: var(--fg);
    font-family: var(--font-ui);
    font-size: inherit;
    cursor: pointer;
  }
  .content :global(button.dur:hover) { background: var(--ghost-hover); }
  .content :global(button.dur:active) { background: var(--ghost-active); }

  /* Command output keeps its own line breaks and column alignment (/pomoc,
     /context's bar) — preformatted, but wrapping on a narrow card. */
  .local-text {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .pick {
    list-style: none;
    margin: var(--space-2) 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .pick-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-h-sm);
    color: var(--fg);
    cursor: pointer;
  }
  .pick-item.muted { color: var(--fg-muted); }
  .pick-item input { accent-color: var(--accent); width: 1.25em; height: 1.25em; }
  .pick-note { color: var(--fg-muted); font-size: var(--text-xs); }

  .pick-actions {
    display: flex;
    gap: var(--space-2);
  }

  .stale { margin: 0; color: var(--warn); font-size: var(--text-sm); }

  .arch-row {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    border-bottom: var(--border-w) solid var(--border);
  }
  .arch-row:last-child { border-bottom: none; }

  .arch-open {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    min-height: var(--control-h-sm);
    padding: var(--space-2);
    background: transparent;
    border: none;
    color: var(--fg);
    font-family: var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .arch-open:hover { background: var(--ghost-hover); }
  .arch-open:active { background: var(--ghost-active); }

  .arch-title {
    font-size: var(--text-base);
    overflow-wrap: anywhere;
  }

  .arch-meta {
    color: var(--fg-muted);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-label);
    overflow-wrap: anywhere;
  }

  .arch-delete {
    flex: 0 0 auto;
    min-width: var(--control-h-sm);
    min-height: var(--control-h-sm);
    padding: 0 var(--space-2);
    border: none;
    background: transparent;
    color: var(--fg-muted);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    cursor: pointer;
  }
  .arch-delete:hover { background: var(--ghost-hover); color: var(--fg); }
  /* Armed: DESIGN.md §8's danger rank — a ghost in --fail, with the label
     itself changing to USUN? so colour never carries it alone. */
  .arch-delete.armed {
    color: var(--fail);
    border: var(--border-w) solid var(--fail);
  }

  /* One line of command chips, scrolled sideways rather than wrapped, so it
     never grows into the log's space on a half-width card. */
  .chips {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar { display: none; }

  .chip {
    flex: 0 0 auto;
    min-height: var(--control-h-sm);
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--fg);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .chip:hover { background: var(--ghost-hover); border-color: var(--border-strong); }
  .chip:active { background: var(--ghost-active); }
  .chip:disabled { color: var(--fg-disabled); cursor: not-allowed; }

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
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .btn-ghost:hover { background: var(--ghost-hover); }
  .btn-ghost:active { background: var(--ghost-active); }
  .btn-ghost:disabled {
    color: var(--fg-disabled);
    border-color: var(--border);
    cursor: not-allowed;
  }

  /* Header and inline actions: the small control height (DESIGN.md §8 —
     the card's main action alone uses --control-h). */
  .btn-sm {
    min-height: var(--control-h-sm);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
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

  /* Found during k7-mobile-responsive's 2-column phone pass: the mic and
     wyslij buttons' full --control-pad-x (16px a side) left the input field
     almost no room in a half-width card — mic+send alone summed past the
     available width, and the send button's own label got clipped. Only
     horizontal padding gives here; min-height (the touch-target floor,
     DESIGN.md §6) is untouched. */
  @media (max-width: 767px) {
    .composer button,
    .head-actions button {
      padding-left: var(--space-2);
      padding-right: var(--space-2);
    }
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
