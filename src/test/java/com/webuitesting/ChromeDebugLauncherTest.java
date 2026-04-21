package com.webuitesting;

import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for ChromeDebugLauncher utility methods that do not require
 * a real browser.
 */
class ChromeDebugLauncherTest {

    // ── loadResource ─────────────────────────────────────────────────────────

    @Test
    void loadResource_returnsNonEmptyScript() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertNotNull(script);
        assertFalse(script.isBlank(), "injection-script.js must not be empty");
    }

    @Test
    void loadResource_scriptContainsRecorderGuard() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("__wutRecorderActive"),
                "Script must contain the double-injection guard");
    }

    @Test
    void loadResource_scriptContainsAllActions() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        String[] requiredActions = {
                "click", "select", "assertWithText", "isEnabled",
                "isVisible", "isEditable", "getTableHeaders", "getTableData", "hover"
        };
        for (String action : requiredActions) {
            assertTrue(script.contains("'" + action + "'") || script.contains("\"" + action + "\""),
                    "Script must include action: " + action);
        }
    }

    @Test
    void loadResource_scriptDisablesLeftClick() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("'click'") || script.contains("\"click\""),
                "Script must handle the click event");
        assertTrue(script.contains("preventDefault"),
                "Script must call preventDefault to disable left-clicks");
        assertTrue(script.contains("stopImmediatePropagation"),
                "Script must call stopImmediatePropagation");
    }

    @Test
    void loadResource_scriptRecordsEvents() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("__recordedEvents"),
                "Script must use window.__recordedEvents");
        assertTrue(script.contains("push"),
                "Script must push events onto __recordedEvents");
    }

    @Test
    void loadResource_scriptOverridesContextMenu() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("contextmenu"),
                "Script must intercept the contextmenu event");
    }

    @Test
    void loadResource_throwsOnMissingResource() {
        assertThrows(IOException.class,
                () -> ChromeDebugLauncher.loadResource("/non-existent-file.js"));
    }

    // ── OUTPUT_FILE constant ──────────────────────────────────────────────────

    @Test
    void outputFile_hasExpectedName() {
        assertEquals("recorded_events.json", ChromeDebugLauncher.OUTPUT_FILE);
    }
}
