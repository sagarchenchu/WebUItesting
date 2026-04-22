/**
 * content.js – Content script for the Page Source Recorder extension.
 *
 * Core algorithm
 * ──────────────
 * 1. On "startRecording":
 *    - Capture the current DOM as `combinedSource` (baseline).
 *    - Start a MutationObserver watching the entire document for child-list
 *      and subtree changes (i.e. dropdown lists appearing / disappearing).
 *
 * 2. On each significant mutation batch (new nodes added):
 *    - Capture the current DOM snapshot.
 *    - Merge it into `combinedSource` using `mergeHTML()`.
 *      The merge walks both DOM trees in parallel and appends any element
 *      present in the new snapshot but absent from the combined tree.
 *      This means dropdown-1 options survive in `combinedSource` even after
 *      dropdown-1 closes and dropdown-2 opens.
 *
 * 3. On "stopRecording":
 *    - Stop the observer.
 *    - Return the final `combinedSource` to the background script.
 */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  let recording        = false;
  let combinedSource   = '';   // accumulated / merged HTML
  let observer         = null;
  let pendingMerge     = false; // debounce flag

  // ── Public message handler ─────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'startRecording') {
      startRecording();
      sendResponse({ success: true });
    } else if (message.action === 'stopRecording') {
      const source = stopRecording();
      sendResponse({ success: true, source });
    }
    return true; // keep message channel open for async sendResponse
  });

  // ── Recording lifecycle ────────────────────────────────────────────────────

  function startRecording() {
    if (recording) return;
    recording      = true;
    combinedSource = captureDOM();

    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree:   true,
    });

    console.log('[PageSourceRecorder] Recording started. Initial source captured.');
  }

  function stopRecording() {
    if (!recording) return combinedSource;
    recording = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    console.log('[PageSourceRecorder] Recording stopped.');
    return combinedSource;
  }

  // ── Mutation handling ──────────────────────────────────────────────────────

  /**
   * Called by the MutationObserver.  We debounce rapid batches (e.g. a
   * dropdown rendering many <li> items in quick succession) so that we do a
   * single merge after the browser settles.
   */
  function onMutations(mutations) {
    if (!recording) return;

    // Check whether any nodes were actually *added* (not just attribute tweaks)
    const hasAdditions = mutations.some(
      (m) => m.type === 'childList' && m.addedNodes.length > 0
    );
    if (!hasAdditions) return;

    if (!pendingMerge) {
      pendingMerge = true;
      // Wait one animation frame so the browser finishes rendering the dropdown
      requestAnimationFrame(() => {
        pendingMerge = false;
        const currentSnapshot = captureDOM();
        combinedSource = mergeHTML(combinedSource, currentSnapshot);
        console.log('[PageSourceRecorder] DOM change detected – combined source updated.');
      });
    }
  }

  // ── DOM capture ────────────────────────────────────────────────────────────

  function captureDOM() {
    return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  }

  // ── HTML merge ─────────────────────────────────────────────────────────────

  /**
   * mergeHTML(combinedHTML, newHTML) → string
   *
   * Parses both HTML strings, then recursively walks the element trees.
   * Any element that exists in `newHTML` but is missing from `combinedHTML`
   * is imported and appended to the matching parent in `combinedHTML`.
   *
   * Matching strategy (in priority order):
   *   1. Same `id` attribute
   *   2. Same tag name + same `class` attribute + same text content prefix
   *   3. Same tag name + positional index (fallback)
   */
  function mergeHTML(combinedHTML, newHTML) {
    const parser      = new DOMParser();
    const combinedDoc = parser.parseFromString(combinedHTML, 'text/html');
    const newDoc      = parser.parseFromString(newHTML,      'text/html');

    mergeElements(combinedDoc.documentElement, newDoc.documentElement, combinedDoc);

    return '<!DOCTYPE html>\n' + combinedDoc.documentElement.outerHTML;
  }

  /**
   * Recursively merge element children from `newEl` into `combinedEl`.
   */
  function mergeElements(combinedEl, newEl, ownerDoc) {
    if (!combinedEl || !newEl) return;

    const newChildren      = Array.from(newEl.children);
    const combinedChildren = Array.from(combinedEl.children);

    newChildren.forEach((newChild, index) => {
      const match = findMatch(newChild, combinedChildren, index);

      if (match) {
        // Recurse – there may be new grand-children (e.g. option groups)
        mergeElements(match, newChild, ownerDoc);
      } else {
        // This element did not exist in the combined tree – import and append it
        const imported = ownerDoc.importNode(newChild, true /* deep */);
        combinedEl.appendChild(imported);
      }
    });
  }

  /**
   * Try to find the best match for `target` among `candidates`.
   * Returns the matching element or null if no reasonable match exists.
   */
  function findMatch(target, candidates, fallbackIndex) {
    // 1. Match by id (most reliable)
    if (target.id) {
      const byId = candidates.find((c) => c.id === target.id);
      if (byId) return byId;
    }

    // 2. Match by tag + class combination
    const sameTagClass = candidates.filter(
      (c) => c.tagName === target.tagName && c.className === target.className
    );
    if (sameTagClass.length === 1) return sameTagClass[0];

    // 3. Match by tag + text content prefix (useful for <option>, <li>, etc.)
    const targetText = (target.textContent || '').trim().substring(0, 50);
    if (targetText) {
      const byText = sameTagClass.find(
        (c) => (c.textContent || '').trim().startsWith(targetText)
      );
      if (byText) return byText;
    }

    // 4. Positional fallback – only if the tag names match
    const sameTag = candidates[fallbackIndex];
    if (sameTag && sameTag.tagName === target.tagName) return sameTag;

    return null;
  }
})();
