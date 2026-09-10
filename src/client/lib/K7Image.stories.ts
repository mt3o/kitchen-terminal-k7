import type { Meta, StoryObj } from '@storybook/web-components-vite'
import { html } from 'lit'

// Importing the module is what registers <k7-image>. Unlike K7Comic/K7AsciiArt
// this card has no server dependency at all — it is a plain <img>, so these
// stories load real placeholder images rather than only showing idle state.
import './K7Image.svelte'

const meta: Meta = {
  title: 'Cards/Image',
  component: 'k7-image',
  parameters: {
    docs: {
      description: {
        component:
          'image: a single static picture from a configured URL. No fetch, no polling, no daily ' +
          'rotation — unlike ascii-art-of-the-day/comic-of-the-day, which both change on a schedule. ' +
          'A carousel whose slides are all `type: image` cards is an image carousel; no separate ' +
          'component exists for that.',
      },
    },
  },
  argTypes: {
    url: { control: 'text' },
    altText: { control: 'text' },
    caption: { control: 'text' },
    linkUrl: { control: 'text' },
    maxWidthPx: { control: 'text' },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 400px; height: 300px">
      <k7-image
        url=${args.url ?? ''}
        altText=${args.altText ?? ''}
        caption=${args.caption ?? ''}
        linkUrl=${args.linkUrl ?? ''}
        maxWidthPx=${args.maxWidthPx ?? ''}
      ></k7-image>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Default: Story = {
  args: { url: 'https://placehold.co/600x400/png', caption: 'przykładowy obraz' },
}

export const WithLink: Story = {
  name: 'With link-through',
  args: {
    url: 'https://placehold.co/600x400/png',
    caption: 'kliknij, aby otworzyć źródło',
    linkUrl: 'https://example.invalid/',
  },
}

export const Failed: Story = {
  name: 'Load failure',
  args: { url: 'https://example.invalid/does-not-exist.png' },
}
