import type { Meta, StoryObj } from '@storybook/web-components-vite'
import { html } from 'lit'

// Importing the module is what registers <k7-unsplash>. Storybook has no dev
// server behind /api/unsplash (and no access key), so these stories render the
// element's honest idle/fail state rather than live photos.
import './K7Unsplash.svelte'

const meta: Meta = {
  title: 'Cards/Unsplash Carousel',
  component: 'k7-unsplash',
  parameters: {
    docs: {
      description: {
        component:
          'unsplash-carousel: photos fetched server-side from the Unsplash API (key never reaches the ' +
          'browser), shown one at a time by swipe, arrows or auto-rotation. Each photo credits its ' +
          'photographer and Unsplash with links, as the Unsplash API guidelines require.',
      },
    },
  },
  argTypes: {
    query: { control: 'text', description: 'Topic; ignored when collections is set.' },
    collections: { control: 'text', description: 'Comma-separated collection ids.' },
    orientation: { control: 'inline-radio', options: ['', 'landscape', 'portrait', 'squarish'] },
    count: { control: 'text' },
    autoAdvanceSeconds: { control: 'text', description: '0 = manual only.' },
    transition: { control: 'inline-radio', options: ['fade', 'slide'] },
    showIndicators: { control: 'boolean' },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 400px; height: 320px">
      <k7-unsplash
        query=${args.query ?? ''}
        collections=${args.collections ?? ''}
        orientation=${args.orientation ?? ''}
        count=${args.count ?? '10'}
        autoAdvanceSeconds=${args.autoAdvanceSeconds ?? '20'}
        transition=${args.transition ?? 'fade'}
        showIndicators=${String(args.showIndicators ?? true)}
      ></k7-unsplash>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Default: Story = {
  args: { query: 'kitchen', orientation: 'landscape', count: '10', autoAdvanceSeconds: '20', transition: 'fade' },
}
