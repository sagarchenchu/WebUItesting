/**
 * background.js – Service worker for the Page Source Recorder extension.
 *
 * Responsibilities:
 *  - Create the two right-click context-menu items ("recordPageSource" and
 *    "stopPageSource") when the extension is installed.
 *  - Track which tabs are currently recording.
 *  - Relay start/stop messages to the content script running in the active tab.
 *  - Receive the final combined source from the content script and trigger a
 *    file download so the user can inspect the accumulated HTML.
 */

const MENU_RECORD = 'recordPageSource';
const MENU_STOP   = 'stopPageSource';

// Set of tab IDs that are currently in recording mode.
const recordingTabs = new Set();

// ── Context-menu setup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id:       MENU_RECORD,
    title:    'recordPageSource',
    contexts: ['all'],
  });

  chrome.contextMenus.create({
    id:       MENU_STOP,
    title:    'stopPageSource',
    contexts: ['all'],
    enabled:  false,   // disabled until recording starts
  });
});

// ── Context-menu click handler ────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === MENU_RECORD) {
    handleStartRecording(tab.id);
  } else if (info.menuItemId === MENU_STOP) {
    handleStopRecording(tab.id);
  }
});

// ── Recording lifecycle ───────────────────────────────────────────────────────

function handleStartRecording(tabId) {
  if (recordingTabs.has(tabId)) return;   // already recording on this tab

  recordingTabs.add(tabId);
  updateMenuState(true);

  chrome.tabs.sendMessage(tabId, { action: 'startRecording' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[PageSourceRecorder] Could not reach content script:', chrome.runtime.lastError.message);
      recordingTabs.delete(tabId);
      updateMenuState(false);
    }
  });
}

function handleStopRecording(tabId) {
  if (!recordingTabs.has(tabId)) return;

  chrome.tabs.sendMessage(tabId, { action: 'stopRecording' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[PageSourceRecorder] Could not reach content script:', chrome.runtime.lastError.message);
    } else if (response && response.source) {
      downloadSource(response.source, tabId);
    }
  });

  recordingTabs.delete(tabId);
  updateMenuState(false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Enable or disable the two context-menu items based on recording state.
 * When recording is active on ANY tab we flip both items so the UX stays
 * consistent regardless of which tab the user right-clicks on.
 */
function updateMenuState(isRecording) {
  chrome.contextMenus.update(MENU_RECORD, { enabled: !isRecording });
  chrome.contextMenus.update(MENU_STOP,   { enabled:  isRecording });
}

/**
 * Trigger a browser download of the accumulated HTML source.
 */
function downloadSource(htmlContent, tabId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `page-source-recorded-${timestamp}.html`;

  // Encode as a data URL so we don't need a temporary blob URL.
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);

  chrome.downloads.download({
    url:      dataUrl,
    filename: filename,
    saveAs:   false,
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn('[PageSourceRecorder] Download failed:', chrome.runtime.lastError.message);
    } else {
      console.log(`[PageSourceRecorder] Source saved as ${filename} (download ID ${downloadId})`);
    }
  });
}

// ── Tab lifecycle cleanup ─────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingTabs.has(tabId)) {
    recordingTabs.delete(tabId);
    if (recordingTabs.size === 0) {
      updateMenuState(false);
    }
  }
});
