import type { Meta, StoryObj } from '@storybook/web-components-vite'
import { html } from 'lit'

// Importing the module is what registers <k7-ascii-art>. Storybook has no
// dev server behind /api/ascii-art, so these stories render whatever the
// element's own idle/fail state looks like — which is exactly the honest
// behaviour the card is supposed to have when the gateway is unreachable,
// not a story-tooling gap.
import './K7AsciiArt.svelte'

const meta: Meta = {
  title: 'Cards/AsciiArt',
  component: 'k7-ascii-art',
  parameters: {
    docs: {
      description: {
        component:
          'ascii-art-of-the-day: a prompt generated once a day through Kilo Gateway. Own AI-generated ' +
          'content — no attribution, no copyright exposure — kept as a separate card type from ' +
          'comic-of-the-day for exactly that reason. The seed shown in the meta line is stored for ' +
          'reproducing a result while debugging a prompt.',
      },
    },
  },
  argTypes: {
    prompt: { control: 'text', description: 'The generation prompt.' },
    model: { control: 'text', description: "Kilo Gateway model id, e.g. 'kilo-auto/free'." },
    cacheDurationHours: { control: 'text', description: 'How long a generated result is served before a fresh one is asked for.' },
    maxWidthChars: { control: 'text' },
    maxHeightLines: { control: 'text' },
    colorized: { control: 'boolean' },
    seed: { control: 'text', description: 'Reuse a prior seed to reproduce its result.' },
    fallbackArt: { control: 'text', description: 'Shown when generation fails and nothing is cached yet.' },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 340px">
      <k7-ascii-art
        prompt=${args.prompt ?? ''}
        model=${args.model ?? ''}
        cacheDurationHours=${args.cacheDurationHours ?? ''}
        maxWidthChars=${args.maxWidthChars ?? ''}
        maxHeightLines=${args.maxHeightLines ?? ''}
        colorized=${args.colorized ?? ''}
        seed=${args.seed ?? ''}
        fallbackArt=${args.fallbackArt ?? ''}
      ></k7-ascii-art>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Default: Story = {
  args: { prompt: 'kot w stylu ASCII art, klimat retro terminal', model: 'kilo-auto/free', cacheDurationHours: '24' },
}

export const WithFallback: Story = {
  name: 'With fallback art',
  args: {
    prompt: 'kot w stylu ASCII art',
    fallbackArt: '  /\\_/\\\n ( o.o )\n  > ^ <',
  },
}
