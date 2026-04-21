/**
 * WebUI Testing — Recorder Injection Script
 *
 * Injected by ChromeDebugLauncher into every page the user navigates to.
 *
 * Behavior:
 *   • Disables all regular left-clicks (contextmenu / keyboard / form submits
 *     are left intact so the page still navigates normally when desired).
 *   • On right-click, shows a custom "WebUI Recorder" context menu whose items
 *     are tailored to the right-clicked element type:
 *       – <select>              → Expand & Select, Click, assertions, …
 *       – <option> in select    → Select This Option, …
 *       – Editable text inputs  → Type, Clear (when non-empty), …
 *       – <input type="file">   → File Upload, …
 *       – All elements          → Click, Assert with Text, isEnabled, isVisible,
 *                                 isEditable, Get Table Headers, Get Table Data, Hover
 *       – Popup / download sect → Handle Alert OK/Cancel, Handle Download
 *   • Choosing an action executes it against the right-clicked element and
 *     appends one JSON event to window.__recordedEvents.  The event bundles
 *     the "mouse-pointed-at" info (element descriptor, mouse position) and
 *     the "action performed" result into a single object.
 *   • A green toast confirms each recording.
 *   • All events are available at window.__recordedEvents for the Java poller
 *     to read via executeScript().
 *   • The script is idempotent: re-injection after navigation is safe.
 */
(function () {
    'use strict';

    // ── Guard against double-injection ────────────────────────────────────────
    if (window.__wutRecorderActive) { return; }
    window.__wutRecorderActive = true;

    // ── Event storage ─────────────────────────────────────────────────────────
    window.__recordedEvents = window.__recordedEvents || [];

    // ── Constants ─────────────────────────────────────────────────────────────
    var MENU_ID   = '__wut_menu';
    var TOAST_ID  = '__wut_toast';
    var Z_MAX     = '2147483647';

    // ── Dynamic menu builder ──────────────────────────────────────────────────

    /**
     * Returns an ordered list of menu-item descriptors appropriate for the
     * given element.  A descriptor is either:
     *   { id: '<actionId>', label: '<display text>' }  — a clickable item
     *   { id: '_sep' }                                  — a visual separator
     */
    function buildMenuItems(el) {
        var tag       = el.tagName.toLowerCase();
        var inputType = (el.getAttribute('type') || '').toLowerCase();
        var items     = [];

        // ── Dropdown (select) ─────────────────────────────────────────────────
        if (tag === 'select') {
            items.push({ id: 'expandDropdown', label: '▼  Expand & Select Option' });
        }

        // ── Option inside an expanded select ──────────────────────────────────
        if (tag === 'option') {
            items.push({ id: 'selectOption', label: '☑  Select This Option' });
        }

        // ── Editable text inputs / textarea ───────────────────────────────────
        // Inputs without a type attribute default to "text" — represented by '' here.
        var isTextInput = (
            (tag === 'input' &&
             ['text', 'email', 'password', 'search', 'tel', 'url', 'number', '']
                 .indexOf(inputType) !== -1) ||
            tag === 'textarea' ||
            el.isContentEditable === true ||
            el.contentEditable   === 'true'
        );
        if (isTextInput && !el.disabled && !el.readOnly) {
            items.push({ id: 'type', label: '⌨  Type' });
            // For input/textarea use .value; for contentEditable elements use .innerText.
            var isContentEditable = el.isContentEditable === true || el.contentEditable === 'true';
            var currentVal = isContentEditable ? el.innerText : (el.value || '');
            if (currentVal.trim() !== '') {
                items.push({ id: 'clear', label: '✕  Clear' });
            }
        }

        // ── File upload ───────────────────────────────────────────────────────
        if (tag === 'input' && inputType === 'file') {
            items.push({ id: 'fileUpload', label: '📁  File Upload' });
        }

        // ── Standard actions (always shown) ───────────────────────────────────
        items.push({ id: 'click',           label: '▶  Click' });
        items.push({ id: 'assertWithText',  label: '✎  Assert with Text' });
        items.push({ id: 'isEnabled',       label: '?  isEnabled' });
        items.push({ id: 'isVisible',       label: '👁  isVisible' });
        items.push({ id: 'isEditable',      label: '✏  isEditable' });
        items.push({ id: 'getTableHeaders', label: '⊞  Get Table Headers' });
        items.push({ id: 'getTableData',    label: '⊟  Get Table Data' });
        items.push({ id: 'hover',           label: '⟳  Hover' });

        // ── Separator + popup / download section ──────────────────────────────
        items.push({ id: '_sep' });
        items.push({ id: 'handleAlertOK',     label: '✔  Handle Alert — OK' });
        items.push({ id: 'handleAlertCancel', label: '✖  Handle Alert — Cancel' });
        items.push({ id: 'handleDownload',    label: '⬇  Handle Download' });

        return items;
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    /** Returns a minimal XPath that uniquely identifies the element. */
    function getXPath(el) {
        if (!el || el.nodeType !== 1) { return ''; }
        if (el.id) { return '//*[@id="' + el.id + '"]'; }
        var parts = [];
        var node = el;
        while (node && node.nodeType === 1) {
            var idx = 1;
            var sib = node.previousSibling;
            while (sib) {
                if (sib.nodeType === 1 && sib.tagName === node.tagName) { idx++; }
                sib = sib.previousSibling;
            }
            parts.unshift(node.tagName.toLowerCase() + '[' + idx + ']');
            node = node.parentNode;
            if (node === document.body) {
                parts.unshift('body');
                break;
            }
        }
        return '//' + parts.join('/');
    }

    /** Returns a short CSS selector for the element (id-based when available). */
    function getCssSelector(el) {
        if (!el) { return ''; }
        if (el.id) { return '#' + el.id; }
        var path = [];
        var node = el;
        while (node && node.nodeType === 1 && node !== document.body) {
            var sel = node.tagName.toLowerCase();
            if (node.id) {
                path.unshift('#' + node.id);
                break;
            }
            if (node.className && typeof node.className === 'string') {
                sel += '.' + node.className.trim().split(/\s+/).join('.');
            }
            path.unshift(sel);
            node = node.parentElement;
        }
        return path.join(' > ');
    }

    /** Builds a plain-object descriptor for the element that is recorded in every event. */
    function describeElement(el) {
        if (!el || el.nodeType !== 1) { return null; }
        return {
            tag:         el.tagName.toLowerCase(),
            id:          el.id          || null,
            name:        el.getAttribute('name')  || null,
            type:        el.getAttribute('type')  || null,
            className:   el.className   || null,
            innerText:   (el.innerText  || '').trim().substring(0, 200),
            value:       (el.value !== undefined && el.value !== null) ? el.value : null,
            xpath:       getXPath(el),
            cssSelector: getCssSelector(el)
        };
    }

    // ── Disable regular left-clicks ───────────────────────────────────────────

    document.addEventListener('click', function (e) {
        // Allow clicks inside our own context-menu so items remain selectable.
        if (e.target && e.target.closest && e.target.closest('#' + MENU_ID)) { return; }
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    // ── Context-menu override ─────────────────────────────────────────────────

    document.addEventListener('contextmenu', function (e) {
        // Do not interfere with clicks inside our own menu.
        if (e.target && e.target.closest && e.target.closest('#' + MENU_ID)) { return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        removeMenu();
        showMenu(e.clientX, e.clientY, e.target);
    }, true);

    // Close menu on Escape.
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { removeMenu(); }
    }, true);

    // ── Context-menu rendering ────────────────────────────────────────────────

    function removeMenu() {
        var m = document.getElementById(MENU_ID);
        if (m && m.parentNode) { m.parentNode.removeChild(m); }
    }

    function showMenu(mouseX, mouseY, targetEl) {
        var menu = document.createElement('div');
        menu.id = MENU_ID;

        // Base styles — dark "Catppuccin Mocha"-inspired palette.
        applyStyles(menu, {
            position:     'fixed',
            zIndex:       Z_MAX,
            left:         mouseX + 'px',
            top:          mouseY + 'px',
            background:   '#1e1e2e',
            color:        '#cdd6f4',
            border:       '1px solid #45475a',
            borderRadius: '8px',
            padding:      '4px 0',
            fontFamily:   'Segoe UI, Arial, sans-serif',
            fontSize:     '13px',
            boxShadow:    '0 6px 20px rgba(0,0,0,0.55)',
            minWidth:     '210px',
            userSelect:   'none',
            cursor:       'default'
        });

        // Title bar
        var title = document.createElement('div');
        title.textContent = '⚡ WebUI Recorder';
        applyStyles(title, {
            padding:       '7px 14px 6px',
            color:         '#89b4fa',
            fontWeight:    'bold',
            fontSize:      '12px',
            letterSpacing: '0.6px',
            borderBottom:  '1px solid #45475a',
            marginBottom:  '3px'
        });
        menu.appendChild(title);

        // Menu items — built dynamically for the target element.
        buildMenuItems(targetEl).forEach(function (item) {
            // Separator
            if (item.id === '_sep') {
                var sep = document.createElement('div');
                applyStyles(sep, { borderTop: '1px solid #45475a', margin: '4px 0' });
                menu.appendChild(sep);
                return;
            }

            var row = document.createElement('div');
            row.textContent = item.label;
            applyStyles(row, {
                padding:    '7px 16px',
                cursor:     'pointer',
                transition: 'background 0.1s'
            });
            row.addEventListener('mouseenter', function () {
                row.style.background = '#313244';
            });
            row.addEventListener('mouseleave', function () {
                row.style.background = '';
            });
            // Use mousedown so the menu can be removed before the action runs.
            row.addEventListener('mousedown', function (e) {
                e.stopPropagation();
                e.preventDefault();
                removeMenu();
                // Slight delay so the menu is fully gone before any prompt.
                setTimeout(function () {
                    executeAction(item.id, targetEl, mouseX, mouseY);
                }, 40);
            });
            menu.appendChild(row);
        });

        document.body.appendChild(menu);

        // Reposition if the menu would overflow the viewport.
        var rect = menu.getBoundingClientRect();
        if (rect.right  > window.innerWidth)  { menu.style.left = (mouseX - rect.width)  + 'px'; }
        if (rect.bottom > window.innerHeight) { menu.style.top  = (mouseY - rect.height) + 'px'; }

        // Dismiss when the user clicks outside.
        setTimeout(function () {
            document.addEventListener('mousedown', outsideClickDismiss, true);
        }, 0);
    }

    function outsideClickDismiss(e) {
        var m = document.getElementById(MENU_ID);
        if (!m || !m.contains(e.target)) {
            removeMenu();
            document.removeEventListener('mousedown', outsideClickDismiss, true);
        }
    }

    // ── Action execution ──────────────────────────────────────────────────────

    /**
     * Performs the chosen action on the target element, then records the
     * event (element descriptor + action result) in window.__recordedEvents.
     */
    function executeAction(actionId, targetEl, mouseX, mouseY) {
        var result;

        switch (actionId) {

            // ── Dropdown: expand so individual options become right-clickable ──
            case 'expandDropdown': {
                var optCount = targetEl.options ? targetEl.options.length : 0;
                // Expose the options as a visible list-box (max 10 rows).
                targetEl.size = Math.min(optCount, 10);
                targetEl.style.zIndex = String(parseInt(Z_MAX, 10) - 2);
                result = {
                    status: 'dropdown expanded',
                    optionCount: optCount,
                    note: 'Right-click an option to record a selectOption event'
                };
                break;
            }

            // ── Option inside an expanded select: record selection ─────────────
            case 'selectOption': {
                // Use closest() to handle options nested inside <optgroup> elements.
                var selectEl = targetEl.closest ? targetEl.closest('select') : null;
                result = {
                    selectedValue: targetEl.value,
                    selectedText:  targetEl.text || targetEl.innerText.trim(),
                    selectElement: selectEl ? describeElement(selectEl) : null
                };
                // Collapse the select back to its normal single-line state.
                if (selectEl) { selectEl.removeAttribute('size'); }
                break;
            }

            // ── Type: record text to be typed into a text field ───────────────
            case 'type': {
                var textToType = window.prompt(
                    'Type action\n\nEnter the text to type into this field:', '');
                if (textToType === null) { return; } // user cancelled
                result = { text: textToType };
                break;
            }

            // ── Clear: record clearing a text field ───────────────────────────
            case 'clear': {
                // For contentEditable elements use innerText; for inputs/textareas use value.
                var isEditable = targetEl.isContentEditable === true ||
                                 targetEl.contentEditable   === 'true';
                var clearedValue = isEditable ? targetEl.innerText.trim() : (targetEl.value || '');
                result = { clearedValue: clearedValue };
                break;
            }

            // ── File upload: record the file path to upload ───────────────────
            case 'fileUpload': {
                var filePath = window.prompt(
                    'File Upload\n\nEnter the absolute path of the file to upload:', '');
                if (filePath === null) { return; } // user cancelled
                result = {
                    filePath: filePath,
                    note: 'Use element.sendKeys(filePath) to replay'
                };
                break;
            }

            // ── Handle Alert — OK ─────────────────────────────────────────────
            case 'handleAlertOK': {
                result = {
                    action: 'OK',
                    note: 'Use driver.switchTo().alert().accept() to replay'
                };
                break;
            }

            // ── Handle Alert — Cancel ─────────────────────────────────────────
            case 'handleAlertCancel': {
                result = {
                    action: 'Cancel',
                    note: 'Use driver.switchTo().alert().dismiss() to replay'
                };
                break;
            }

            // ── Handle Download ───────────────────────────────────────────────
            case 'handleDownload': {
                var downloadDir = window.prompt(
                    'Handle Download\n\nEnter the directory path where the file should be saved:',
                    '');
                if (downloadDir === null) { return; } // user cancelled
                result = {
                    downloadDirectory: downloadDir,
                    note: 'Set Chrome prefs download.default_directory to this path before replay'
                };
                break;
            }

            // ── Legacy / always-visible actions ───────────────────────────────

            case 'click':
                result = { status: 'click recorded' };
                break;

            case 'assertWithText': {
                var actual   = (targetEl.innerText || '').trim();
                var expected = window.prompt('Assert with Text\n\nEnter expected text:', actual);
                if (expected === null) { return; } // User cancelled the prompt.
                result = {
                    expectedText: expected,
                    actualText:   actual,
                    match:        actual === expected
                };
                break;
            }

            case 'isEnabled':
                result = { enabled: !targetEl.disabled };
                break;

            case 'isVisible': {
                var cs   = window.getComputedStyle(targetEl);
                var br   = targetEl.getBoundingClientRect();
                result = {
                    visible: cs.display     !== 'none'   &&
                             cs.visibility  !== 'hidden' &&
                             parseFloat(cs.opacity) > 0  &&
                             br.width  > 0               &&
                             br.height > 0
                };
                break;
            }

            case 'isEditable': {
                var tag = targetEl.tagName.toLowerCase();
                result = {
                    editable: !targetEl.readOnly &&
                              !targetEl.disabled &&
                              (tag === 'input'    ||
                               tag === 'textarea' ||
                               targetEl.isContentEditable === true ||
                               targetEl.contentEditable   === 'true')
                };
                break;
            }

            case 'getTableHeaders': {
                // Prefer the nearest ancestor table; fall back to the whole document.
                var tableScope = (targetEl.closest ? targetEl.closest('table') : null) || document;
                var ths = Array.from(tableScope.querySelectorAll('th'));
                result = { headers: ths.map(function (th) { return th.innerText.trim(); }) };
                break;
            }

            case 'getTableData': {
                var tbl = (targetEl.closest ? targetEl.closest('table') : null)
                       || document.querySelector('table');
                if (tbl) {
                    var rows = Array.from(tbl.querySelectorAll('tr')).map(function (tr) {
                        return Array.from(tr.querySelectorAll('td, th')).map(function (cell) {
                            return cell.innerText.trim();
                        });
                    }).filter(function (r) { return r.length > 0; });
                    result = { tableData: rows };
                } else {
                    result = { tableData: [], status: 'no <table> element found' };
                }
                break;
            }

            case 'hover':
                result = { status: 'hover recorded' };
                break;

            default:
                result = { status: 'unknown action: ' + actionId };
        }

        recordEvent(actionId, targetEl, mouseX, mouseY, result);
    }

    // ── Event recording ───────────────────────────────────────────────────────

    /**
     * Appends one event to window.__recordedEvents.
     * The mouse-position / element-pointer info and the chosen action are
     * merged into a single event object (as required by the spec).
     */
    function recordEvent(actionId, targetEl, mouseX, mouseY, result) {
        var event = {
            timestamp: new Date().toISOString(),
            action: actionId,
            mousePosition: { x: mouseX, y: mouseY },
            element: describeElement(targetEl),
            result: result
        };
        window.__recordedEvents.push(event);

        var n = window.__recordedEvents.length;
        console.log('[WebUITesting] Event #' + n + ' recorded:\n' +
                    JSON.stringify(event, null, 2));
        showToast('✓ ' + actionId + ' recorded  (#' + n + ')');
    }

    // ── Toast notification ────────────────────────────────────────────────────

    function showToast(msg) {
        // Remove any existing toast first.
        var old = document.getElementById(TOAST_ID);
        if (old && old.parentNode) { old.parentNode.removeChild(old); }

        var toast = document.createElement('div');
        toast.id = TOAST_ID;
        toast.textContent = msg;
        applyStyles(toast, {
            position:     'fixed',
            bottom:       '24px',
            right:        '24px',
            background:   '#a6e3a1',
            color:        '#1e1e2e',
            padding:      '10px 20px',
            borderRadius: '6px',
            zIndex:       String(parseInt(Z_MAX, 10) - 1),
            fontFamily:   'Segoe UI, Arial, sans-serif',
            fontSize:     '13px',
            fontWeight:   'bold',
            boxShadow:    '0 2px 8px rgba(0,0,0,0.3)',
            opacity:      '1',
            transition:   'opacity 0.4s ease'
        });
        document.body.appendChild(toast);
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () {
                if (toast.parentNode) { toast.parentNode.removeChild(toast); }
            }, 400);
        }, 2000);
    }

    // ── Style helper ──────────────────────────────────────────────────────────

    function applyStyles(el, styles) {
        Object.keys(styles).forEach(function (k) { el.style[k] = styles[k]; });
    }

    // ── Ready ─────────────────────────────────────────────────────────────────

    console.log('[WebUITesting] ✓ Recorder active. Left-click disabled. Right-click any element.');

}());
