# K7 Terminal Icons

This directory contains the core logo and branding assets for the **Kitchen Terminal K7** project.

## Files and Usage

### `logo-main.png` (Option 1 Var A)
- **Primary Logo & Icon:** This is the main identifier for the project. 
- **Where to use:** Use this for the main application icon, favicon (`favicon.ico`), and anywhere the primary K7 brand needs to be represented clearly.

### `logo-badge.png` (Option 2 Var A)
- **Technical Emblem / Badge:** A sleeker, stark technical emblem focusing on sharp circuits.
- **Where to use:** 
  - **Empty States:** As a background watermark or icon when a widget (like the shopping list or recipes) has no data.
  - **Loading Indicator:** Can be animated (e.g., spinning or pulsing opacity) to show when the backend is fetching data or when the AI chat is thinking.
  - **Settings/Diagnostic Menu:** If a "system diagnostic" view or hidden settings screen is added, this badge serves perfectly as the header icon.

### `logo-splash.png` (Option 3 Var A)
- **Conceptual Splash Logo:** Blending the terminal HUD with a stylized culinary shape (a knife).
- **Where to use:** 
  - **Splash Screen:** Use this as the primary image displayed while the PWA is loading or starting up. It sets the exact retro-futuristic kitchen tone right away.
  - **Screensaver/Idle State:** Could also be used as a full-screen screensaver when the terminal enters an idle state.

## Note on Formats

All three are genuine PNG, 1024x1024, 8-bit RGB. They were originally shipped as
JPEG data under a `.png` extension, which would have broken any PWA manifest
declaring `"type": "image/png"` — that has been corrected in place, filenames
unchanged.

Two caveats that still stand:

- **No alpha channel.** Each logo is baked onto an opaque near-black background,
  so it cannot be overlaid on a themed surface. If a logo ever has to sit on a
  light theme or on a card background, it needs re-exporting with transparency
  rather than recolouring in CSS.
- **1024x1024 is the only size.** PWA manifests and iOS `apple-touch-icon` want a
  set of sizes (at minimum 180, 192 and 512 px). Downscale at build time rather
  than shipping a 1 MB image to the iPad for a 180 px slot.

Generating SVG versions (by vectorizing with Illustrator or Inkscape) remains the
recommended long-term fix — it solves the sizing and the retina sharpness at once.
Both PNG limitations above disappear with a vector source.
