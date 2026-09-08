import type { StorybookConfig } from '@storybook/web-components-vite'

/**
 * Storybook runs the **web-components** renderer, not the Svelte one.
 *
 * The components ship as custom elements — that is what the app loads and what a
 * consumer gets. Rendering them here as internal Svelte components would exercise
 * something the product never uses, and would stop catching the failure that
 * already bit this project once: a build where `customElement` was dropped and
 * `<k7-card>` was never registered.
 *
 * There is deliberately no `viteFinal` adding vite-plugin-svelte. Storybook
 * detects Svelte in the project and configures that plugin itself — adding it
 * again compiles every component twice and fails inside the compiler on its own
 * generated output, which reads as a syntax error in the component rather than as
 * a duplicated plugin. Its Vite root is the project root, so it picks up the
 * `svelte.config.js` that carries `customElement: true`.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/web-components-vite', options: {} },
  stories: ['../src/client/**/*.stories.@(ts|svelte)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
}

export default config
