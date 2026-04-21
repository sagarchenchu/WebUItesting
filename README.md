# WebUI Testing — Chrome Debug Recorder

**Assistive way of Automation** — a Java tool that launches Chrome in debug mode,
injects a non-intrusive recorder script into every page, and captures user
interactions as structured JSON events.

---

## How it works

1. **Launch** — run the jar to open a Chrome window.
2. **Navigate** — type any URL in the address bar and press Enter.
3. **Interact** — right-click any element on the page; a custom context menu appears.
4. **Record** — choose an action; the tool records **one event** containing both the
   "element pointed at" and the "action performed".
5. **Review** — events are continuously written to `recorded_events.json`.

Regular **left-clicks are disabled** on this debug window so every interaction
must be intentional and goes through the recorder.

---

## Available actions (right-click menu)

| Action | Description |
|---|---|
| **Click** | Records a click on the element |
| **Select** | For `<select>` elements — records all options and their selected state |
| **Assert with Text** | Prompts for expected text; records expected vs actual text and whether they match |
| **isEnabled** | Records whether the element is enabled (`!disabled`) |
| **isVisible** | Records whether the element is visible (display, visibility, opacity, size) |
| **isEditable** | Records whether the element is editable (input / textarea / contentEditable) |
| **Get Table Headers** | Records all `<th>` text values from the nearest `<table>` |
| **Get Table Data** | Records all `<tr>`/`<td>` text values from the nearest `<table>` |
| **Hover** | Records a hover action on the element |

---

## Event format

Each recorded event is a JSON object:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "action": "assertWithText",
  "mousePosition": { "x": 542, "y": 318 },
  "element": {
    "tag": "h1",
    "id": "page-title",
    "name": null,
    "type": null,
    "className": "title",
    "innerText": "Welcome to My App",
    "value": null,
    "xpath": "//*[@id=\"page-title\"]",
    "cssSelector": "#page-title"
  },
  "result": {
    "expectedText": "Welcome to My App",
    "actualText": "Welcome to My App",
    "match": true
  }
}
```

All events for a session are saved as a JSON array in `recorded_events.json`.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Java | 17+ |
| Maven | 3.8+ |
| Google Chrome | Any recent stable release |

> **ChromeDriver is downloaded automatically** by Selenium Manager — no manual setup needed.

---

## Build & run

```bash
# Build the executable fat-jar
mvn clean package -DskipTests

# Run
java -jar target/WebUItesting-1.0-SNAPSHOT.jar
```

Or run directly via Maven:

```bash
mvn compile exec:java -Dexec.mainClass=com.webuitesting.ChromeDebugLauncher
```

---

## Running the tests

```bash
mvn test
```

