import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'
// `Decorator` lives in the renderer package; the -vite entry only re-exports the
// framework config types.
import type { Decorator } from '@storybook/web-components'

// Importing the module is what registers <k7-weather>. If this import is dropped,
// every story below renders an empty unknown element — which is exactly the
// failure this renderer choice exists to catch.
import './K7Weather.svelte'

/** A full, fresh /api/weather response — the shape the component actually parses. */
const FRESH_PAYLOAD = {
  ageSeconds: 40,
  stale: false,
  source: 'open-meteo',
  data: {
    units: { temperature: '°C', windSpeed: 'km/h' },
    now: { temperature: 18.4, apparentTemperature: 17.1, humidity: 62, windSpeed: 11.3, weatherCode: 2 },
    daily: [
      { date: '2026-09-09', weatherCode: 2, temperatureMax: 21, temperatureMin: 12 },
      { date: '2026-09-10', weatherCode: 61, temperatureMax: 17, temperatureMin: 10 },
      { date: '2026-09-11', weatherCode: 1, temperatureMax: 22, temperatureMin: 13 },
      { date: '2026-09-12', weatherCode: 95, temperatureMax: 19, temperatureMin: 11 },
    ],
  },
}

/** Same payload, but old enough that the backend has flagged it stale. */
const STALE_PAYLOAD = {
  ...FRESH_PAYLOAD,
  ageSeconds: 5400,
  stale: true,
}

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * There is no backend in Storybook, so every story must fake `window.fetch`
 * rather than let the component's `$effect` hang on a request that never
 * resolves — a spinner-forever story is worse than no story. The stub is
 * installed per-story and torn down on unmount so it can never leak into a
 * story rendered after it.
 */
// Typed through Storybook's own decorator type rather than `unknown`: the
// renderer needs a real template back, and `unknown` compiles here while
// failing where the decorator is actually used.
function withFetch(stub: FetchStub): Decorator {
  return (story) => {
    const original = window.fetch
    window.fetch = stub as typeof window.fetch
    const result = story()
    // Restoring synchronously is fine: the component's own fetch call has
    // already been dispatched by the time this decorator's story() returns.
    queueMicrotask(() => {
      window.fetch = original
    })
    return result
  }
}

const meta: Meta = {
  title: 'Cards/Weather',
  component: 'k7-weather',
  parameters: {
    docs: {
      description: {
        component:
          'SYS.POGODA. Calls /api/weather, which answers with an age and a stale flag — the ' +
          'card renders both, and a stale answer says so in warn rather than showing a number ' +
          'that looks current. Storybook has no backend, so every story stubs window.fetch to a ' +
          'deterministic response instead of letting the effect hang.',
      },
    },
  },
  argTypes: {
    lat: { control: 'text', description: 'Latitude passed to /api/weather.' },
    lon: { control: 'text', description: 'Longitude passed to /api/weather.' },
    units: { control: 'text', description: 'Unit system requested from the backend.' },
    refresh: { control: 'text', description: 'Seconds between refreshes (clamped to a 60s floor).' },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 340px">
      <k7-weather
        lat=${args.lat ?? '52.2297'}
        lon=${args.lon ?? '21.0122'}
        units=${args.units ?? 'metric'}
        refresh=${args.refresh ?? '900'}
      ></k7-weather>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Loaded: Story = {
  decorators: [withFetch(async () => new Response(JSON.stringify(FRESH_PAYLOAD), { status: 200 }))],
}

/**
 * The freshness rule made visible: same numbers, but the backend has marked
 * them old enough to warn on. If this card ever looks identical to Loaded,
 * the stale disclosure has silently broken.
 */
export const Stale: Story = {
  decorators: [withFetch(async () => new Response(JSON.stringify(STALE_PAYLOAD), { status: 200 }))],
}

/** No response yet and nothing cached — the card's very first paint. */
export const Empty: Story = {
  decorators: [
    withFetch(
      async () =>
        new Promise<Response>(() => {
          /* never resolves — mirrors the pre-first-response idle state deliberately */
        }),
    ),
  ],
}

export const Failed: Story = {
  name: 'Failed (no data yet)',
  decorators: [withFetch(async () => new Response('upstream down', { status: 502 }))],
}
