/**
 * WebUI Testing — Recorder Injection Script
 *
 * Injected by ChromeDebugLauncher into every page the user navigates to.
 *
 * Behavior:
 *   • Disables all regular left-clicks (contextmenu / keyboard / form submits
 *     are left intact so the page still navigates normally when desired).
 *   • On right-click, shows a custom "WebUI Recorder" context-menu over the
 *     target element with the following actions:
 *       Click | Select | Assert with Text | isEnabled | isVisible | isEditable
 *       Get Table Headers | Get Table Data | Hover
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

    var MENU_ITEMS = [
        { id: 'click',           label: '▶  Click' },
        { id: 'select',          label: '☑  Select' },
        { id: 'assertWithText',  label: '✎  Assert with Text' },
        { id: 'isEnabled',       label: '?  isEnabled' },
        { id: 'isVisible',       label: '👁  isVisible' },
        { id: 'isEditable',      label: '✏  isEditable' },
        { id: 'getTableHeaders', label: '⊞  Get Table Headers' },
        { id: 'getTableData',    label: '⊟  Get Table Data' },
        { id: 'hover',           label: '⟳  Hover' }
    ];

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

        // Menu items
        MENU_ITEMS.forEach(function (item) {
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

            case 'click':
                result = { status: 'click recorded' };
                break;

            case 'select':
                if (targetEl.tagName.toLowerCase() === 'select') {
                    result = {
                        options: Array.from(targetEl.options).map(function (o) {
                            return { value: o.value, text: o.text, selected: o.selected };
                        })
                    };
                } else {
                    result = { status: 'element is not a <select>; select recorded' };
                }
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
