# WebUItesting
Assistive way of Automation

## Page Source Recorder – Chrome Extension

A Chrome extension (Manifest V3) that accumulates the full page source across
multiple dropdown interactions.  When you navigate to a page with dynamic
dropdowns whose options are injected into the DOM only when the dropdown is
open, the extension collects every state and merges them into one combined HTML
file you can download and inspect.

### How it works

| Step | What you do | What the extension does |
|------|-------------|-------------------------|
| 1 | Right-click anywhere → **recordPageSource** | Captures the initial DOM as the baseline `combinedSource` and starts a `MutationObserver` |
| 2 | Open a dropdown | Detects the new child nodes (option list), captures the current DOM snapshot, and merges it into `combinedSource` |
| 3 | Close that dropdown and open another | Repeats the merge — the first dropdown's options are preserved in `combinedSource` even though they are no longer in the live DOM |
| 4 | Right-click anywhere → **stopPageSource** | Stops the observer and downloads `page-source-recorded-<timestamp>.html` containing the full accumulated source |

### Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this repository folder.
4. The extension is now active on all pages.

### File structure

```
manifest.json   – Extension manifest (MV3)
background.js   – Service worker: context-menu management, download trigger
content.js      – Content script: MutationObserver, DOM-merge algorithm
```

### Merge algorithm

`mergeHTML(combinedHTML, newHTML)` walks both DOM trees in parallel.  For each
element in `newHTML` it looks for a match in `combinedHTML` using these rules
(in priority order):

1. Same `id` attribute
2. Same tag name + same `class` attribute (single match)
3. Same tag name + matching text-content prefix
4. Same tag name at the same child index (positional fallback)

If no match is found the element is **imported and appended** to the parent in
`combinedHTML`, so content that has since been removed from the live DOM is
retained for later inspection.
