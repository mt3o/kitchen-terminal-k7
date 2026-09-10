import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

// Registers <k7-carousel>. Slides are ordinary cards, registered here too —
// exactly how main.ts's createWidget builds them: recursively, as light-DOM
// children the shadow-DOM <slot> projects.
import './K7Carousel.svelte'
import './K7Card.svelte'

const meta: Meta = {
  title: 'Cards/Carousel',
  component: 'k7-carousel',
  parameters: {
    docs: {
      description: {
        component:
          'KARUZELA — the `carousel` card type. A container card that pages through its ' +
          'slides one at a time via swipe or the prev/next controls, with optional ' +
          'auto-rotation. Slides are ordinary cards passed as light-DOM children; this ' +
          'component only paginates them, it never constructs one. Click the ‹ › controls or ' +
          'drag on touch hardware to page manually.',
      },
    },
  },
  argTypes: {
    autoAdvanceSeconds: { control: 'number', description: '0 = manual only (swipe/buttons).' },
    startDelaySeconds: { control: 'number', description: 'Delay before the FIRST auto-advance only.' },
    loop: { control: 'boolean' },
    showIndicators: { control: 'boolean' },
    swipeEnabled: { control: 'boolean' },
    transition: { control: 'inline-radio', options: ['slide', 'fade'] },
  },
  render: (args: Record<string, string | boolean | number>) => html`
    <div style="max-width: 400px; height: 320px">
      <k7-carousel
        autoAdvanceSeconds=${String(args.autoAdvanceSeconds ?? 0)}
        startDelaySeconds=${String(args.startDelaySeconds ?? 0)}
        loop=${String(args.loop ?? true)}
        showIndicators=${String(args.showIndicators ?? true)}
        swipeEnabled=${String(args.swipeEnabled ?? true)}
        transition=${args.transition ?? 'slide'}
      >
        <k7-card label="ZEGAR" glance="17:03" state="ok"></k7-card>
        <k7-card label="SYS.POGODA" glance="18°C" body="pochmurnie" state="ok"></k7-card>
        <k7-card label="LISTA.ZAKUPY" glance="3" body="pozycje do kupienia" state="ok"></k7-card>
      </k7-carousel>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Manual: Story = {
  name: 'Manual, slide transition',
  args: { autoAdvanceSeconds: 0, loop: true, showIndicators: true, swipeEnabled: true, transition: 'slide' },
}

export const AutoAdvanceFade: Story = {
  name: 'Auto-advance, fade transition',
  args: { autoAdvanceSeconds: 4, startDelaySeconds: 2, loop: true, showIndicators: true, transition: 'fade' },
}

export const NoLoop: Story = {
  name: 'No loop — clamps at both ends',
  args: { autoAdvanceSeconds: 0, loop: false, showIndicators: true, swipeEnabled: true, transition: 'slide' },
}
