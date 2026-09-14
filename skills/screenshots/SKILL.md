---
name: screenshots
description: >
  Capture, annotate, and share UI screenshots using Playwright. Use whenever a user
  requests a UI change, wants to see a rendered page or element, or needs visual
  evidence (design reviews, visual regression, docs). Supports page, element,
  full-page, responsive multi-device, annotated captures, PDF export and video.
  Trigger phrases: "screenshot", "show me the UI", "capture the page", "ui change",
  "make the <element> <attribute>", "design review", "visual test", "responsive",
  "before and after".
---

# UI Screenshots (Playwright)

Capture and share screenshots of any web UI using `playwright-cli`. The single most
important behavior: **when a user asks for a UI change, capture the result and attach
the image to your reply so they can see it inline** — do not just describe the change.

This skill is built on the Playwright CLI (`playwright-cli`). Do **not** use the
`agent-browser` CLI or any non-Playwright screenshot tool — all flows below go through
`playwright-cli` and its `run-code` API.

## The Rule (UI changes)

Whenever the user requests a change to a UI element, layout, or style:

1. Make the change in code.
2. Reload/reopen the affected page if needed (`playwright-cli navigate <url>`).
3. Capture a screenshot of the affected page or element.
4. **Attach the image file to your reply** so it renders inline in the chat.
5. If it helps the user verify, also capture a "before" shot prior to the change and
   attach both side-by-side.

Attach by referencing the saved file in your reply using the runtime's image-attachment
convention — a markdown image link works in most runtimes:

```markdown
![UI result](./path/to/shot.png)
```

Never skip step 4. A UI change without a screenshot is an incomplete answer.

## When NOT to Use

- The asset is a static image already in the repo — just `read` it.
- You only need DOM structure or element refs — use `playwright-cli snapshot`, not a screenshot.
- The change is pure backend/logic with no visible UI surface.

## Prerequisites

- The `@playwright/cli` package must be installed globally (it provides the `playwright-cli`
  binary). Install the CLI, then download the browser engine:
  ```bash
  npm install -g @playwright/cli@latest
  playwright-cli install-browser
  ```
- A running dev server or reachable URL for the target app.
- A browser binary that Playwright can drive (Chromium is the default and required for PDF).

## Quick Reference

```bash
playwright-cli screenshot                          # viewport shot, auto filename
playwright-cli screenshot --filename=out.png       # custom filename
playwright-cli snapshot                            # list element refs (e.g. e5)
playwright-cli screenshot e5 --filename=el.png     # element-only shot
playwright-cli resize 375 812                      # mobile viewport
playwright-cli resize 375 812 && playwright-cli screenshot --filename=mobile.png
```

## Page & Element Captures

### Page screenshot (visible viewport)

```bash
playwright-cli screenshot --filename=homepage.png
```

### Element screenshot

Capture a single element (component-level verification):

```bash
playwright-cli snapshot                 # get refs first
playwright-cli screenshot e5 --filename=product-card.png
```

### Full-page screenshot

Capture the entire scrollable page, not just the viewport:

```bash
playwright-cli run-code "async page => {
  await page.screenshot({ path: 'full-page.png', fullPage: true });
  return 'Saved full-page screenshot';
}"
```

### Advanced screenshot options (run-code)

Use `page.screenshot` options for quality, clipping, transparency, masking, or to freeze animations:

```bash
# JPEG with quality + full page
playwright-cli run-code "async page => {
  await page.screenshot({ path: 'optimized.jpg', type: 'jpeg', quality: 80, fullPage: true });
}"

# Clip to a region (e.g. header)
playwright-cli run-code "async page => {
  await page.screenshot({ path: 'header.png', clip: { x: 0, y: 0, width: 1280, height: 200 } });
}"

# Transparent background (for elements with transparency)
playwright-cli run-code "async page => {
  await page.screenshot({ path: 'transparent.png', omitBackground: true });
}"

# Mask dynamic/noisy content (ads, avatars, timestamps)
playwright-cli run-code "async page => {
  await page.screenshot({
    path: 'masked.png',
    mask: [
      page.locator('.ad-banner'),
      page.locator('.user-avatar'),
      page.locator('.timestamp')
    ]
  });
}"

# Freeze CSS animations before capturing
playwright-cli run-code "async page => {
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      el.style.animation = 'none';
      el.style.transition = 'none';
    });
  });
  await page.screenshot({ path: 'no-animations.png' });
}"
```

## Responsive / Multi-Device Captures

Capture the same page at multiple viewports to verify responsive behavior:

```bash
# Manual per-size
playwright-cli resize 1920 1080 && playwright-cli screenshot --filename=desktop.png
playwright-cli resize 1366 768 && playwright-cli screenshot --filename=laptop.png
playwright-cli resize 768 1024  && playwright-cli screenshot --filename=tablet.png
playwright-cli resize 375 812   && playwright-cli screenshot --filename=mobile.png
```

Or automate the whole sweep in one call:

```bash
playwright-cli run-code "async page => {
  const viewports = [
    { name: 'desktop',   width: 1920, height: 1080 },
    { name: 'laptop',    width: 1366, height: 768  },
    { name: 'tablet',    width: 768,  height: 1024 },
    { name: 'mobile',    width: 375,  height: 812  },
    { name: 'mobile-sm', width: 320,  height: 568  }
  ];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);   // allow layout to settle
    await page.screenshot({ path: \`responsive-\${vp.name}.png\` });
  }
  return 'Captured ' + viewports.length + ' responsive screenshots';
}"
```

On narrow viewports, keep annotations sparse (max ~2) to avoid crowding.

## Annotated Captures (design reviews)

For design reviews or call-outs, draw a temporary outline/label on the page before capturing.
This is the Playwright-native equivalent of the `annotate` helpers in the alexanderop skill.

```bash
# Highlight an element with a red outline and capture
playwright-cli run-code "async page => {
  await page.evaluate(() => {
    const el = document.querySelector('#add-to-cart');
    if (el) {
      el.style.outline = '3px solid red';
      el.scrollIntoView({ block: 'center' });
    }
  });
  await page.screenshot({ path: 'annotated-addtocart.png' });
}"
```

To add a numbered label, inject a small floating badge via `page.evaluate` before the screenshot,
then remove it (or just re-navigate) when done. Keep it to 1–3 annotations per shot; split into
multiple screenshots if you need more.

## Media: PDF & Video

### PDF export (Chromium only)

```bash
playwright-cli pdf --filename=report.pdf
```

```bash
# Custom PDF options
playwright-cli run-code "async page => {
  await page.pdf({
    path: 'report.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
  });
}"
```

### Video / screencast (Playwright 1.59+)

```bash
# Start a screencast with explicit path + size
playwright-cli run-code "async page => {
  await page.screencast.start({ path: 'recordings/flow.webm', size: { width: 1280, height: 800 } });
}"

# Annotated actions + chapter title
playwright-cli run-code "async page => {
  await page.screencast.showActions({ position: 'top-right', duration: 900, fontSize: 20 });
  await page.screencast.showChapter('Checkout', { description: 'Verify totals', duration: 1500 });
}"

# Stop and finalize
playwright-cli run-code "async page => { await page.screencast.stop(); }"
```

Legacy recording still works for simple flows: `playwright-cli video-start` then `playwright-cli video-stop demo.webm`.

## Visual Regression Diff

`playwright-cli screenshot` captures, but it does not diff. For persistent visual-regression
testing, author a Playwright test using `expect(locator).toHaveScreenshot()` against a stored
baseline. Use that workflow when you need reproducible before/after comparisons across builds.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "screenshot path not found" | `playwright-cli` not on PATH — install the Playwright CLI skill or export the bin dir. |
| Blank / spinner in shot | Page not fully loaded — add `await page.waitForTimeout(N)` or a networkidle wait before `screenshot`. |
| Element shot returns full page | You passed a wrong ref — re-run `playwright-cli snapshot` and use the exact `eN` ref. |
| PDF fails | Using a non-Chromium browser — PDF only works with Chromium. |
| Animation blur | Disable animations via the `run-code` "freeze animations" snippet. |
| Overlay/cookie banner blocks view | Dismiss it first via `playwright-cli` (click the accept ref) before capturing. |

## Sources

This skill inherits the workflow and annotation concepts from:

- `app-screenshots` (alexanderop) — annotated documentation workflow.
- `playwright-cli/screenshots-and-media` (testdino-hq) — Playwright CLI commands (primary).
- `browser-screenshot` (Igosuki via Smithery) — full-page / viewport / responsive scope.
