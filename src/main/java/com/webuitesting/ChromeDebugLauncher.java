package com.webuitesting;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Scanner;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * ChromeDebugLauncher — main entry point for the WebUI Testing recorder.
 *
 * <p>Can be used as a standalone executable <em>or</em> embedded in any Java/Maven
 * project as a library dependency (artifact {@code com.webuitesting:WebUItesting:1.0-SNAPSHOT}).
 *
 * <p><b>Library usage (recommended):</b>
 * <pre>{@code
 *   ChromeDebugLauncher recorder = ChromeDebugLauncher.create().invoke();
 *   // … interact with the browser …
 *   recorder.stop();
 * }</pre>
 *
 * <p><b>Workflow:</b>
 * <ol>
 *   <li>Launches Chrome with the remote-debugging port enabled (9222).</li>
 *   <li>Injects a recorder script into every page the user navigates to.</li>
 *   <li>The injected script disables regular left-clicks and shows a custom
 *       right-click context menu with element-aware actions:
 *       Click, Type, Clear, Expand &amp; Select Option, Select This Option,
 *       Assert with Text, isEnabled, isVisible, isEditable,
 *       Get Table Headers, Get Table Data, Hover,
 *       Handle Alert OK/Cancel, File Upload, Handle Download.</li>
 *   <li>Each action is stored as a JSON event in {@code window.__recordedEvents}
 *       and periodically flushed to {@value #OUTPUT_FILE}.</li>
 * </ol>
 */
public class ChromeDebugLauncher {

    /** Path of the output file where recorded JSON events are written. */
    static final String OUTPUT_FILE = "recorded_events.json";

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private final WebDriver driver;
    private final AtomicReference<String> lastInjectedUrl = new AtomicReference<>("");
    private final AtomicBoolean scriptActive = new AtomicBoolean(false);
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "wut-poller");
                t.setDaemon(true);
                return t;
            });

    // ── Constructor ───────────────────────────────────────────────────────────

    ChromeDebugLauncher(WebDriver driver) {
        this.driver = driver;
    }

    // ── Factory / main entry point ────────────────────────────────────────────

    /**
     * Creates and returns a {@link ChromeDebugLauncher} with a freshly opened
     * Chrome window configured for debugging.
     */
    public static ChromeDebugLauncher create() {
        ChromeOptions opts = new ChromeOptions();
        // Expose the Chrome DevTools remote debugging endpoint.
        opts.addArguments("--remote-debugging-port=9222");
        opts.addArguments("--start-maximized");
        opts.addArguments("--disable-notifications");
        // Remove the "Chrome is being controlled by automated software" banner
        // so the browser looks as natural as possible to the user.
        opts.setExperimentalOption("excludeSwitches", Arrays.asList("enable-automation"));
        opts.setExperimentalOption("useAutomationExtension", false);
        return new ChromeDebugLauncher(new ChromeDriver(opts));
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Convenience entry point — starts the recorder and returns {@code this}
     * for fluent chaining, so the library can be used as a single expression:
     *
     * <pre>{@code
     *   // Typical library usage:
     *   ChromeDebugLauncher recorder = ChromeDebugLauncher.create().invoke();
     *   // … user right-clicks elements in the browser …
     *   recorder.stop();
     * }</pre>
     *
     * @return this launcher (already started)
     */
    public ChromeDebugLauncher invoke() {
        start();
        return this;
    }

    /** Starts the background poller that maintains script injection and flushes events. */
    public void start() {
        printBanner();
        scheduler.scheduleAtFixedRate(this::pollAndMaintain, 500, 500, TimeUnit.MILLISECONDS);
    }

    /** Stops the poller, flushes any remaining events to disk, and closes the browser. */
    public void stop() {
        System.out.println("\n[INFO] Stopping recorder …");
        scheduler.shutdownNow();
        flushEvents();
        System.out.println("[INFO] Events saved to: " + OUTPUT_FILE);
        try {
            driver.quit();
        } catch (Exception ignored) {
            // Browser may already be closed.
        }
    }

    // ── Core poller ───────────────────────────────────────────────────────────

    /**
     * Called every 500 ms by the scheduler.
     * Re-injects the recorder script whenever the page URL changes or the
     * script flag has been cleared (e.g. after a hard reload).
     */
    void pollAndMaintain() {
        try {
            String url = driver.getCurrentUrl();
            // Ignore blank / new-tab states.
            if (url == null || url.isBlank() || url.equals("data:,") || url.equals("about:blank")) {
                return;
            }

            boolean navigated = !url.equals(lastInjectedUrl.get());
            if (navigated) {
                lastInjectedUrl.set(url);
                scriptActive.set(false);
                // Give the page a moment to start rendering before injecting.
                Thread.sleep(600);
            }

            if (!scriptActive.get() && isPageReady()) {
                injectRecorderScript();
                scriptActive.set(true);
                System.out.println("[INFO] Recorder injected into: " + url);
            }

            flushEvents();
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        } catch (Exception ignored) {
            // Driver may be mid-navigation; the next tick will retry.
        }
    }

    // ── Script injection ──────────────────────────────────────────────────────

    boolean isPageReady() {
        try {
            Object state = ((JavascriptExecutor) driver)
                    .executeScript("return document.readyState");
            return "complete".equals(state) || "interactive".equals(state);
        } catch (Exception e) {
            return false;
        }
    }

    void injectRecorderScript() throws IOException {
        String script = loadResource("/injection-script.js");
        ((JavascriptExecutor) driver).executeScript(script);
    }

    // ── Event flushing ────────────────────────────────────────────────────────

    /**
     * Reads {@code window.__recordedEvents} from the browser, pretty-prints
     * the JSON, and overwrites {@value #OUTPUT_FILE}.
     */
    void flushEvents() {
        try {
            Object raw = ((JavascriptExecutor) driver)
                    .executeScript(
                            "return window.__recordedEvents"
                            + " ? JSON.stringify(window.__recordedEvents)"
                            + " : '[]'");
            if (raw == null) return;
            String json = raw.toString();
            if ("[]".equals(json)) return;

            Object parsed = GSON.fromJson(json, Object.class);
            String pretty = GSON.toJson(parsed);
            try (PrintWriter pw = new PrintWriter(new FileWriter(OUTPUT_FILE, false))) {
                pw.print(pretty);
            }
        } catch (Exception ignored) {
            // Transient errors (e.g. page navigating) are silently ignored.
        }
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    static String loadResource(String path) throws IOException {
        try (InputStream is = ChromeDebugLauncher.class.getResourceAsStream(path)) {
            if (is == null) {
                throw new IOException("Classpath resource not found: " + path);
            }
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void printBanner() {
        System.out.println("╔═══════════════════════════════════════════════════════╗");
        System.out.println("║      WebUI Testing — Chrome Debug Recorder            ║");
        System.out.println("╠═══════════════════════════════════════════════════════╣");
        System.out.println("║  Chrome is open. Steps:                               ║");
        System.out.println("║  1. Enter a URL in the address bar and press Enter.   ║");
        System.out.println("║  2. RIGHT-CLICK any element to record an action.      ║");
        System.out.println("║     (regular left-click is disabled on this window)   ║");
        System.out.println("║  3. Recorded events are auto-saved to:                ║");
        System.out.println("║     recorded_events.json                              ║");
        System.out.println("║  4. Press ENTER in this console to quit.              ║");
        System.out.println("╚═══════════════════════════════════════════════════════╝");
    }

    // ── main ──────────────────────────────────────────────────────────────────

    public static void main(String[] args) throws Exception {
        ChromeDebugLauncher launcher = ChromeDebugLauncher.create().invoke();

        // Shut down cleanly when the JVM is terminated (e.g. Ctrl+C).
        Runtime.getRuntime().addShutdownHook(new Thread(launcher::stop, "shutdown-hook"));

        // Block until the user presses ENTER.
        try (Scanner sc = new Scanner(System.in)) {
            sc.nextLine();
        }
        launcher.stop();
        System.exit(0);
    }
}
