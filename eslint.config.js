// ESLint 9 flat config (ESM). See CLAUDE.md: components read only CSS custom
// properties for theming; this file has no opinion on that, it only lints JS/TS/Svelte.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'

// No `globals` package is installed on purpose — these are the small, hand-written
// subsets this project actually touches, split per runtime (browser vs Node) so a
// server file can't accidentally rely on `window` and vice versa.
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  HTMLElement: 'readonly',
  customElements: 'readonly',
  CustomEvent: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  AudioContext: 'readonly',
  webkitAudioContext: 'readonly',
  AnalyserNode: 'readonly',
  MediaStream: 'readonly',
  MediaStreamConstraints: 'readonly',
  DOMException: 'readonly',
  SubmitEvent: 'readonly',
  Event: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  URL: 'readonly',
  Intl: 'readonly',
  TextDecoder: 'readonly',
}

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
  require: 'readonly',
  exports: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
}

// These two rules matter enough to this project to be errors rather than
// suggestions: `eqeqeq` because layout/theme values come off the wire as
// loosely-typed YAML/JSON, and `no-console` (with warn/error allowed) because a
// wall-mounted kiosk has no devtools attached — stray console.log is silent noise
// forever, but warn/error are the only diagnostics anyone will ever see.
const projectRules = {
  eqeqeq: 'error',
  'no-console': ['error', { allow: ['warn', 'error'] }],
}

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'context/**', 'docs/**', 'design-system/**', '.claude/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,

  // Make `<script lang="ts">` inside .svelte files understood: eslint-plugin-svelte's
  // recommended config already wires svelte-eslint-parser as the top-level parser for
  // .svelte files, but that parser needs to be told which parser to hand the <script>
  // block to.
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },

  {
    files: ['src/**/*.ts', 'src/**/*.svelte', '*.ts', '*.js'],
    rules: projectRules,
  },

  {
    files: ['src/client/**/*.{ts,svelte}'],
    languageOptions: {
      globals: browserGlobals,
    },
  },

  {
    files: ['src/server/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: nodeGlobals,
    },
  },

  // The service worker is a classic script in a worker global scope — not a
  // module and not a browser window. Without its own globals, every `self`,
  // `caches` and `fetch` in it reads as undefined.
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        console: 'readonly',
      },
    },
  },
)
