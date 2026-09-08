import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

// Importing the module is what registers <k7-card>. If this import is dropped,
// every story below renders an empty unknown element — which is exactly the
// failure this renderer choice exists to catch.
import './K7Card.svelte'

const meta: Meta = {
  title: 'Cards/Card',
  component: 'k7-card',
  parameters: {
    docs: {
      description: {
        component:
          'The atom of the whole product. Every card type in the layout contract is this ' +
          'shell plus a body. Ships as a custom element; these stories drive the element the ' +
          'app actually loads.',
      },
    },
  },
  argTypes: {
    label: { control: 'text', description: 'HUD label. Uppercase, wide tracking.' },
    glance: { control: 'text', description: 'Glance tier — read from the doorway at 3 m.' },
    body: { control: 'text', description: 'Read tier — read at the counter at 1 m.' },
    meta: { control: 'text', description: 'True meta only: seeds, cache stamps, token counts.' },
    state: { control: 'inline-radio', options: ['ok', 'warn', 'fail', 'idle'] },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 340px">
      <k7-card
        label=${args.label ?? ''}
        glance=${args.glance ?? ''}
        body=${args.body ?? ''}
        meta=${args.meta ?? ''}
        state=${args.state ?? 'idle'}
      ></k7-card>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Clock: Story = {
  args: { label: 'ZEGAR', glance: '17:03', body: 'wtorek, 8 września', meta: '15:03:13', state: 'ok' },
}

export const Awaiting: Story = {
  name: 'Awaiting implementation',
  args: { label: 'SYS.POGODA', body: 'oczekuje na implementacje', meta: 'weather', state: 'idle' },
}

/**
 * Every state carries a bracket glyph as well as a colour. A wall display is read
 * at an angle, in sunlight, by people with colour-vision deficiency, through a
 * greasy screen protector — so the glyph is the carrier and the colour is
 * reinforcement, not the other way round.
 */
export const States: Story = {
  render: () => html`
    <div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-3); max-width:720px">
      ${(['ok', 'warn', 'fail', 'idle'] as const).map(
        (state) => html`
          <k7-card
            label="STATUS.${state.toUpperCase()}"
            body=${`state=${state}`}
            meta="badge"
            state=${state}
          ></k7-card>
        `,
      )}
    </div>
  `,
}

/**
 * Amber is the ink, teal is the signal. Teal appears at most twice per card, so a
 * deck where every card is `ok` is a deck where teal has stopped meaning anything.
 */
export const Deck: Story = {
  name: 'Deck at 1024×768',
  parameters: { viewport: { defaultViewport: 'ipad' } },
  render: () => html`
    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--space-3)">
      <k7-card label="ZEGAR" glance="17:03" body="wtorek, 8 września" meta="15:03:13" state="ok"></k7-card>
      <k7-card label="SYS.POGODA" body="oczekuje na implementacje" meta="weather" state="idle"></k7-card>
      <k7-card label="LOG.WYDARZENIA" body="oczekuje na implementacje" meta="calendar" state="idle"></k7-card>
      <k7-card label="LISTA.ZAKUPY" glance="3" body="pozycje do kupienia" meta="local" state="ok"></k7-card>
      <k7-card label="MINUTNIK" glance="04:20" body="pozostalo" meta="timer" state="warn"></k7-card>
      <k7-card label="CHAT.AI" body="gateway nie odpowiada" meta="kilo-auto/free" state="fail"></k7-card>
    </div>
  `,
}
