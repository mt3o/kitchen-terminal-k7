import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'

// Importing the module is what registers <k7-recipes>. Dropped, every story
// below renders an empty unknown element instead of the card the app loads —
// the same failure the web-components renderer choice exists to catch.
import './K7Recipes.svelte'

const meta: Meta = {
  title: 'Cards/Recipes',
  component: 'k7-recipes',
  parameters: {
    docs: {
      description: {
        component:
          'Recipe import (schema.org/Recipe JSON-LD, falling back to a Readability-based ' +
          'heuristic) with a review-before-save step: POST /api/recipes/import only extracts, ' +
          'nothing is written until the household edits/approves it in the review form.',
      },
    },
  },
  argTypes: {
    maxVisible: { control: 'text', description: 'How many recipes the list fetches.' },
    allowUrlImport: { control: 'inline-radio', options: ['true', 'false'] },
    tags: { control: 'text', description: 'Comma-separated filter. Empty = all.' },
  },
  render: (args: Record<string, string>) => html`
    <div style="max-width: 380px">
      <k7-recipes
        maxVisible=${args.maxVisible ?? '6'}
        allowUrlImport=${args.allowUrlImport ?? 'true'}
        tags=${args.tags ?? ''}
      ></k7-recipes>
    </div>
  `,
}
export default meta

type Story = StoryObj

/**
 * The default story exercises the real component against the real
 * `/api/recipes*` endpoints. In Storybook's own dev server those routes do
 * not exist, so this is expected to render the idle/failed load state — the
 * same "no placeholder data as real" honesty the card follows when the
 * backend genuinely is unreachable. Run against `npm run dev:server` (see
 * `.storybook/main.ts`'s Vite root) to see the populated states live.
 */
export const Empty: Story = {
  args: { maxVisible: '6', allowUrlImport: 'true', tags: '' },
}

export const ImportDisabled: Story = {
  name: 'Import disabled (allowUrlImport: false)',
  args: { maxVisible: '6', allowUrlImport: 'false', tags: '' },
}

export const FilteredByTag: Story = {
  name: 'Filtered to one tag',
  args: { maxVisible: '6', allowUrlImport: 'true', tags: 'obiad' },
}
