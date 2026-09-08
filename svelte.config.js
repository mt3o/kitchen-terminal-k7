import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Components ship as custom elements — the Web Components requirement from
    // TECH-STACK.md, satisfied without hand-writing them.
    customElement: true,
  },
}
