import { withThemeByDataAttribute } from '@storybook/addon-themes'

import type { Preview } from '@storybook/web-components-vite'

// The generated token sheet, loaded before anything renders — the same order the
// app uses, because a component that resolves no var(--*) looks broken in a way
// that has nothing to do with the component.
import '../design-system/tokens.css'

const preview: Preview = {
  parameters: {
    // Storybook's default white canvas would make an amber-on-charcoal HUD
    // unreadable and every contrast judgement wrong.
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|colour|color)$/i } },
    options: { storySort: { order: ['Design System', 'Cards'] } },
  },
  decorators: [
    // Three luminance modes, switchable from the toolbar. `night` is roughly
    // nine times dimmer than `dark` and still clears WCAG AA — worth being able
    // to look at, since nobody will notice it is broken at 06:00 otherwise.
    withThemeByDataAttribute({
      themes: { dark: 'dark', light: 'light', night: 'night' },
      defaultTheme: 'dark',
      attributeName: 'data-mode',
    }),
    (story) => {
      // The app paints --bg on <body>; Storybook's canvas needs the same or the
      // surface ramp is judged against the wrong ground.
      document.body.style.background = 'var(--bg)'
      document.body.style.fontFamily = 'var(--font-ui)'
      return story()
    },
  ],
}

export default preview
