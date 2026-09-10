import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

// Registers <k7-grid>. Its cells are ordinary cards, registered here too —
// exactly how main.ts's createWidget builds them: recursively, as light-DOM
// children the shadow-DOM <slot> projects.
import './K7Grid.svelte'
import './K7Card.svelte'
import './K7Timer.svelte'

const meta: Meta = {
  title: 'Cards/Grid',
  component: 'k7-grid',
  parameters: {
    docs: {
      description: {
        component:
          'SIATKA — the `grid` card type (CardGrid in the domain model). A container card ' +
          'whose cells are all visible at once in a nested mini-grid, unlike `carousel` which ' +
          'pages through slides one at a time. Cells are ordinary cards passed as light-DOM ' +
          'children; this component only lays them out.',
      },
    },
  },
  argTypes: {
    columns: { control: 'number', description: 'Mini-grid column count. Default 2 per the schema.' },
    gap: { control: 'text', description: 'A raw CSS length, e.g. "8px" — a runtime layout value, not a token.' },
  },
  render: (args: { columns?: string; gap?: string }) => html`
    <div style="max-width: 480px">
      <k7-grid columns=${args.columns ?? '2'} gap=${args.gap ?? '8px'}>
        <k7-card label="TEMP" glance="18°C" state="ok"></k7-card>
        <k7-card label="WILGOTNOSC" glance="54%" state="ok"></k7-card>
        <k7-card label="WIATR" glance="12 km/h" state="ok"></k7-card>
        <k7-card label="CISNIENIE" glance="1013 hPa" state="idle"></k7-card>
      </k7-grid>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Indicators: Story = {
  name: 'Four indicators, 2 columns',
  args: { columns: '2', gap: '8px' },
}

export const SingleColumn: Story = {
  name: 'Single column',
  args: { columns: '1', gap: '8px' },
}

/** Nesting: a grid cell can be any card type, including another container —
 *  this is what makes a grid-of-carousels or a grid-of-clocks work for free. */
export const NestedCarousel: Story = {
  name: 'A cell that is itself a carousel',
  render: () => html`
    <div style="max-width: 480px">
      <k7-grid columns="2" gap="8px">
        <k7-card label="TEMP" glance="18°C" state="ok"></k7-card>
        <k7-timer presets="5,10,15"></k7-timer>
      </k7-grid>
    </div>
  `,
}
