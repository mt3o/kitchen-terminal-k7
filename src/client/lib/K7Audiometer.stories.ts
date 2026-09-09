import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

// Importing the module is what registers <k7-audiometer>. If this import is
// dropped, every story below renders an empty unknown element — which is
// exactly the failure this renderer choice exists to catch.
import './K7Audiometer.svelte'

const meta: Meta = {
  title: 'Cards/Audiometer',
  component: 'k7-audiometer',
  parameters: {
    docs: {
      description: {
        component:
          'AUDIOMETR. Never touches getUserMedia until the household presses the one solid ' +
          'amber control, so its idle state — mic off, nothing requested — is what every story ' +
          'shows by default. Storybook has no microphone and must never trigger a real ' +
          'permission prompt; the Denied story drives that state by stubbing ' +
          'navigator.mediaDevices.getUserMedia to reject, exactly as a real browser would after ' +
          'a "block" choice, without touching the component itself.',
      },
    },
  },
  argTypes: {
    historyDurationSeconds: { control: 'text', description: 'Seconds of history kept for the histogram.' },
    sampleIntervalMs: { control: 'text', description: 'Milliseconds between samples.' },
    unit: { control: 'inline-radio', options: ['percent', 'db'], description: 'Display unit for the level.' },
    showCurrentLevel: { control: 'boolean', description: 'Show the glance-tier numeric readout.' },
    showHistogram: { control: 'boolean', description: 'Show the scrolling bar histogram.' },
    warningThreshold: { control: 'text', description: 'Level above which bars/readout switch to warn.' },
  },
  render: (args: Record<string, string | boolean | undefined>) => html`
    <div style="max-width: 340px">
      <k7-audiometer
        historyDurationSeconds=${String(args.historyDurationSeconds ?? '180')}
        sampleIntervalMs=${String(args.sampleIntervalMs ?? '500')}
        unit=${String(args.unit ?? 'percent')}
        showCurrentLevel=${String(args.showCurrentLevel ?? true)}
        showHistogram=${String(args.showHistogram ?? true)}
        warningThreshold=${String(args.warningThreshold ?? '')}
      ></k7-audiometer>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Idle: Story = {
  name: 'Idle (mic off)',
}

/**
 * Drives the "denied" phase without ever requesting real microphone access:
 * stubs getUserMedia to reject with the same DOMException name Safari/Chrome
 * use after a user has blocked the permission, then clicks the card's own
 * "wlacz mikrofon" button to trigger enableMic(). The stub is restored on
 * unmount so a later story never inherits a mocked mediaDevices.
 */
export const Denied: Story = {
  decorators: [
    (story) => {
      const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          ...navigator.mediaDevices,
          getUserMedia: async () => {
            throw new DOMException('Permission denied', 'NotAllowedError')
          },
        },
      })
      const result = story()
      queueMicrotask(() => {
        if (original) {
          Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { ...navigator.mediaDevices, getUserMedia: original },
          })
        }
      })
      return result
    },
  ],
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector('k7-audiometer')?.shadowRoot?.querySelector('button')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  },
}
