import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'
// `Decorator` lives in the renderer package; the -vite entry only re-exports the
// framework config types.
import type { Decorator } from '@storybook/web-components'

// Importing the module is what registers <k7-chat>. If this import is dropped,
// every story below renders an empty unknown element.
import './K7Chat.svelte'

const MODELS = [
  { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', pricing: { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.00001 } },
  { id: 'kilo-auto/free', name: 'Auto Free', pricing: { promptUsdPerToken: 0, completionUsdPerToken: 0 } },
]

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Storybook has no backend, so every story fakes `window.fetch` rather than
 * let the component's effects hang on requests that never resolve — this is
 * the same `withFetch` shape K7Weather.stories.ts established (see plan.md),
 * reused rather than reinvented, and extended here so a stub can answer the
 * SSE turn endpoint with a real `ReadableStream` body.
 */
function withFetch(stub: FetchStub): Decorator {
  return (story) => {
    const original = window.fetch
    window.fetch = stub as typeof window.fetch
    const result = story()
    queueMicrotask(() => {
      window.fetch = original
    })
    return result
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A real SSE body: delta chunks then a done frame, exactly as routes/chat.ts writes them. */
function sseResponse(deltas: string[], usage = { promptTokens: 12, completionTokens: 6, costUsd: 0.0002 }): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const content of deltas) {
        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ type: 'delta', content })}\n\n`))
      }
      controller.enqueue(
        encoder.encode(`event: done\ndata: ${JSON.stringify({ type: 'done', message: { content: deltas.join('') }, usage })}\n\n`),
      )
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function routedFetch(routes: { models?: unknown; costHistory?: unknown; onSend?: () => Response }): FetchStub {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('/api/gateway/models')) return jsonResponse(routes.models ?? MODELS)
    if (url.startsWith('/api/chat/cost-history')) return jsonResponse(routes.costHistory ?? { recent: [], totals: { calls: 0, costUsd: 0 } })
    if (url.startsWith('/api/chat/conversations') && url.endsWith('/messages') === false && !url.includes('?')) {
      return jsonResponse({ id: 'demo-conversation' }, 201)
    }
    if (url.includes('/messages')) return routes.onSend ? routes.onSend() : sseResponse(['Cze', 'sc!'])
    return jsonResponse({})
  }
}

const meta: Meta = {
  title: 'Cards/Chat',
  component: 'k7-chat',
  parameters: {
    docs: {
      description: {
        component:
          'CZAT.AI. Model picker backed by GET /api/gateway/models, an SSE turn endpoint read by hand ' +
          '(EventSource cannot POST a body), and a cost-today figure pulled from /api/chat/cost-history. ' +
          'Storybook has no backend, so every story stubs window.fetch.',
      },
    },
  },
  argTypes: {
    defaultModel: { control: 'text' },
    voiceInput: { control: 'inline-radio', options: ['true', 'false'] },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 420px; height: 480px">
      <k7-chat
        defaultModel=${args.defaultModel ?? 'anthropic/claude-sonnet-5'}
        voiceInput=${args.voiceInput ?? 'false'}
      ></k7-chat>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Idle: Story = {
  decorators: [withFetch(routedFetch({}))],
}

export const WithMic: Story = {
  name: 'Mikrofon w czacie (disabled affordance)',
  args: { voiceInput: 'true' },
  decorators: [withFetch(routedFetch({}))],
}

/** A model list still loading — the pre-first-response idle state. */
export const LoadingModels: Story = {
  decorators: [
    withFetch(
      async () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    ),
  ],
}

export const ModelsUnavailable: Story = {
  name: 'Failed model fetch (falls back to the configured default)',
  decorators: [withFetch(async () => new Response('gateway down', { status: 502 }))],
}
