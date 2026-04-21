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
        // Original actions
        String[] requiredActions = {
                "click", "assertWithText", "isEnabled",
                "isVisible", "isEditable", "getTableHeaders", "getTableData", "hover"
        };
        for (String action : requiredActions) {
            assertTrue(script.contains("'" + action + "'") || script.contains("\"" + action + "\""),
                    "Script must include action: " + action);
        }
        // New actions added in phase 2
        String[] newActions = {
                "expandDropdown", "selectOption", "type", "clear",
                "fileUpload", "handleAlertOK", "handleAlertCancel", "handleDownload"
        };
        for (String action : newActions) {
            assertTrue(script.contains("'" + action + "'") || script.contains("\"" + action + "\""),
                    "Script must include new action: " + action);
        }
    }

    @Test
    void loadResource_scriptHasDynamicMenuBuilder() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("buildMenuItems"),
                "Script must have a dynamic buildMenuItems function");
        assertTrue(script.contains("expandDropdown"),
                "buildMenuItems must handle <select> elements with expandDropdown");
        assertTrue(script.contains("selectOption"),
                "buildMenuItems must handle <option> elements with selectOption");
        assertTrue(script.contains("'type'") || script.contains("\"type\""),
                "buildMenuItems must include Type action for text inputs");
        assertTrue(script.contains("'clear'") || script.contains("\"clear\""),
                "buildMenuItems must include Clear action for filled text inputs");
        assertTrue(script.contains("fileUpload"),
                "buildMenuItems must include fileUpload action for file inputs");
        assertTrue(script.contains("handleAlertOK"),
                "buildMenuItems must include handleAlertOK for popup handling");
        assertTrue(script.contains("handleAlertCancel"),
                "buildMenuItems must include handleAlertCancel for popup handling");
        assertTrue(script.contains("handleDownload"),
                "buildMenuItems must include handleDownload for file download");
    }

    @Test
    void loadResource_scriptHandlesDropdownExpand() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("expandDropdown"),
                "Script must expand dropdown on right-click of <select>");
        assertTrue(script.contains("targetEl.size"),
                "Script must set size to expose options as a list-box");
        assertTrue(script.contains("selectOption"),
                "Script must handle selectOption when user right-clicks an option");
        assertTrue(script.contains("removeAttribute('size')") || script.contains("removeAttribute(\"size\")"),
                "Script must collapse the dropdown after option is selected");
    }

    @Test
    void loadResource_scriptHandlesTypeAndClear() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("case 'type'") || script.contains("case \"type\""),
                "Script must have a 'type' action case");
        assertTrue(script.contains("case 'clear'") || script.contains("case \"clear\""),
                "Script must have a 'clear' action case");
        assertTrue(script.contains("textToType"),
                "Script must prompt for text in the type action");
        assertTrue(script.contains("clearedValue"),
                "Script must record the cleared value in the clear action");
    }

    @Test
    void loadResource_scriptHandlesPopupAndDownload() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("handleAlertOK"),
                "Script must handle alert OK");
        assertTrue(script.contains("handleAlertCancel"),
                "Script must handle alert Cancel");
        assertTrue(script.contains("accept()"),
                "Script must document use of alert.accept() for OK");
        assertTrue(script.contains("dismiss()"),
                "Script must document use of alert.dismiss() for Cancel");
        assertTrue(script.contains("handleDownload"),
                "Script must handle file download");
        assertTrue(script.contains("downloadDirectory"),
                "Script must record downloadDirectory in the handleDownload event");
    }

    @Test
    void loadResource_scriptHandlesFileUpload() throws IOException {
        String script = ChromeDebugLauncher.loadResource("/injection-script.js");
        assertTrue(script.contains("fileUpload"),
                "Script must handle file upload");
        assertTrue(script.contains("filePath"),
                "Script must prompt for and record the file path in fileUpload event");
        assertTrue(script.contains("sendKeys"),
                "Script must document use of sendKeys() to replay file upload");
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
