import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

import './K7Menu.svelte'

const items = JSON.stringify([
  { cardId: 'audiometr', label: 'AUDIO' },
  { cardId: 'minutnik-kuchnia', label: 'CZAS' },
])

const meta: Meta = {
  title: 'Cards/Menu',
  component: 'k7-menu',
  parameters: {
    docs: {
      description: {
        component:
          'MENU — the `menu` card type. A switcher that picks which of several other cards ' +
          'is active, without rendering their content itself (layout.schema.yaml params.menu; ' +
          'see layout.yaml\'s real menu-kuchnia/audiometr/minutnik-kuchnia trio). This story ' +
          'demonstrates the picker UI and active-state styling only — the actual show/hide ' +
          'coordination with its target cards is page-level, wired in main.ts via the ' +
          '`k7-menu-change` event, not something this isolated component can do on its own.',
      },
    },
  },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    style: { control: 'inline-radio', options: ['tabs', 'icons', 'list'] },
  },
  render: (args: { orientation?: string; style?: string }) => html`
    <div style="max-width: 320px">
      <k7-menu items=${items} orientation=${args.orientation ?? 'vertical'} style=${args.style ?? 'icons'}></k7-menu>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Vertical: Story = {
  args: { orientation: 'vertical', style: 'icons' },
}

export const HorizontalTabs: Story = {
  name: 'Horizontal, tabs style',
  args: { orientation: 'horizontal', style: 'tabs' },
}

export const List: Story = {
  args: { orientation: 'vertical', style: 'list' },
}
