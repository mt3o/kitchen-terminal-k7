import type { Meta, StoryObj } from '@storybook/web-components-vite'
import { html } from 'lit'

// Importing the module is what registers <k7-comic>. Storybook has no dev
// server behind /api/comic, so these stories render the element's honest
// idle/fail state rather than a live feed image.
import './K7Comic.svelte'

const meta: Meta = {
  title: 'Cards/Comic',
  component: 'k7-comic',
  parameters: {
    docs: {
      description: {
        component:
          'comic-of-the-day: an image pulled from an RSS/Atom feed. Third-party content — attribution ' +
          'and a link back to the source are part of the contract, kept as a separate card type from ' +
          'ascii-art-of-the-day for exactly that reason.',
      },
    },
  },
  argTypes: {
    rssUrl: { control: 'text' },
    itemSelector: { control: 'text', description: 'CSS selector used to extract the image when there is no enclosure/media:content.' },
    filterKeywords: { control: 'text', description: 'Comma-separated; matched case-insensitively against title/description.' },
    cacheDurationHours: { control: 'text' },
    maxWidthPx: { control: 'text' },
    linkToSource: { control: 'boolean' },
    creditText: { control: 'text', description: 'Attribution text, e.g. "Zrodlo: simonscat.com".' },
    fallbackImageUrl: { control: 'text', description: 'Shown when the feed fetch fails and nothing is cached yet.' },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 400px">
      <k7-comic
        rssUrl=${args.rssUrl ?? ''}
        itemSelector=${args.itemSelector ?? ''}
        filterKeywords=${args.filterKeywords ?? ''}
        cacheDurationHours=${args.cacheDurationHours ?? ''}
        maxWidthPx=${args.maxWidthPx ?? ''}
        linkToSource=${args.linkToSource ?? ''}
        creditText=${args.creditText ?? ''}
        fallbackImageUrl=${args.fallbackImageUrl ?? ''}
      ></k7-comic>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Default: Story = {
  args: { rssUrl: 'https://example.invalid/feed.xml', cacheDurationHours: '24', creditText: 'Zrodlo: example.invalid' },
}

export const WithFallback: Story = {
  name: 'With fallback image',
  args: {
    rssUrl: 'https://example.invalid/feed.xml',
    fallbackImageUrl: 'https://placehold.co/380x280/png',
    creditText: 'Zrodlo: example.invalid',
  },
}
