import { html } from 'lit'

import type { Meta, StoryObj } from '@storybook/web-components-vite'
// `Decorator` lives in the renderer package; the -vite entry only re-exports the
// framework config types.
import type { Decorator } from '@storybook/web-components'

// Importing the module is what registers <k7-shopping-list>. If this import is
// dropped, every story below renders an empty unknown element — which is
// exactly the failure this renderer choice exists to catch.
import './K7ShoppingList.svelte'

interface Item {
  id: string
  label: string
  category: string | null
  checked: boolean
  createdAt: string
  updatedAt: string
}

const now = '2026-09-09T08:00:00.000Z'

const ITEMS: Item[] = [
  { id: '1', label: 'mleko', category: 'nabial', checked: false, createdAt: now, updatedAt: now },
  { id: '2', label: 'jajka', category: 'nabial', checked: false, createdAt: now, updatedAt: now },
  { id: '3', label: 'chleb', category: 'pieczywo', checked: false, createdAt: now, updatedAt: now },
  { id: '4', label: 'kawa', category: null, checked: false, createdAt: now, updatedAt: now },
]

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * There is no backend in Storybook, and this card has no optimistic updates —
 * every checkbox tap round-trips through fetch by design (see the component's
 * own comment on why). So a story that leaves window.fetch untouched either
 * hangs on "wczytywanie" forever or throws on the first render. The stub is
 * installed per-story and restored on unmount so it never leaks into whatever
 * story renders next.
 */
// Typed through Storybook's own decorator type rather than `unknown`: the
// renderer needs a real template back, and `unknown` compiles here while
// failing where the decorator is actually used.
function withFetch(stub: FetchStub): Decorator {
  return (story) => {
    const original = window.fetch
    window.fetch = stub as typeof window.fetch
    const result = story()
    queueMicrotask(() => {
      window.fetch = original
    })
    return result
  }
}

const meta: Meta = {
  title: 'Cards/ShoppingList',
  component: 'k7-shopping-list',
  parameters: {
    docs: {
      description: {
        component:
          'LISTA.ZAKUPY. Reads and writes /api/shopping-list with no optimistic updates — a ' +
          'checkbox only flips once the server confirms it, because two people can edit this ' +
          'list from different devices at once. Storybook stubs window.fetch per story so the ' +
          'GET is deterministic; the add-item form and checkbox PATCH still hit the stub too.',
      },
    },
  },
  argTypes: {
    groupByCategory: { control: 'boolean', description: 'Group rows by category ("true"/"false" attr).' },
    showCheckedItems: { control: 'boolean', description: 'Include already-checked rows in the GET.' },
  },
  render: (args: { groupByCategory?: boolean; showCheckedItems?: boolean }) => html`
    <div style="max-width: 340px">
      <k7-shopping-list
        groupByCategory=${String(args.groupByCategory ?? true)}
        showCheckedItems=${String(args.showCheckedItems ?? false)}
      ></k7-shopping-list>
    </div>
  `,
}
export default meta

type Story = StoryObj

export const Loaded: Story = {
  args: { groupByCategory: true, showCheckedItems: false },
  decorators: [
    withFetch(async (input) => {
      const url = String(input)
      if (url.includes('/api/shopping-list/')) {
        // PATCH toggle — echo the row back as checked so the click has visible effect.
        return new Response(JSON.stringify({ ...ITEMS[0], checked: true }), { status: 200 })
      }
      if (url.includes('/api/shopping-list')) {
        return new Response(JSON.stringify(ITEMS), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }),
  ],
}

export const Empty: Story = {
  args: { groupByCategory: true, showCheckedItems: false },
  decorators: [withFetch(async () => new Response(JSON.stringify([]), { status: 200 }))],
}

export const Failed: Story = {
  decorators: [withFetch(async () => new Response('db unavailable', { status: 500 }))],
}
