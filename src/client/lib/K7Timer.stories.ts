import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

// Importing the module is what registers <k7-timer>. If this import is dropped,
// every story below renders an empty unknown element — which is exactly the
// failure this renderer choice exists to catch.
import './K7Timer.svelte'

const meta: Meta = {
  title: 'Cards/Timer',
  component: 'k7-timer',
  parameters: {
    docs: {
      description: {
        component:
          'MINUTNIK. No network, no device API — presets, a running readout and a finished ' +
          'state are all driven from setInterval against a local deadline, so these stories need ' +
          'no stubbing. Click a preset to start it and watch the card badge move idle -> ok -> warn.',
      },
    },
  },
  argTypes: {
    presets: { control: 'text', description: 'Comma-separated whole minutes, e.g. "5,10,15,30".' },
    soundOnComplete: {
      control: 'boolean',
      description: 'Whether a finished timer beeps (Web Audio; silently no-ops without a user gesture).',
    },
  },
  render: (args: { presets?: string; soundOnComplete?: boolean }) => html`
    <div style="max-width: 340px">
      <k7-timer
        presets=${args.presets ?? '5,10,15,30'}
        soundOnComplete=${String(args.soundOnComplete ?? true)}
      ></k7-timer>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Idle: Story = {
  args: { presets: '5,10,15,30', soundOnComplete: true },
}

export const CustomPresets: Story = {
  name: 'Custom presets',
  args: { presets: '1,2,3', soundOnComplete: true },
}
