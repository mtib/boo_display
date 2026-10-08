# Boo Display - Project Notes

## Overview
ESPHome project for ESP32 WROOM with a Hono/Bun proxy server and a React web dashboard. Config file: `boo_display.yaml`, secrets in `secrets.yaml` (gitignored). Server in `server/`. Web app in `web/`.

## Hardware
- **Board**: ESP32 WROOM (`esp32dev`), Arduino framework
- **DHT11**: GPIO13 — temperature & humidity, 10s update interval. Temperature is calibrated via `calibrate_linear` (datapoints `6.8 -> 8`, `24 -> 21`) then rounded to a multiple of 0.1°C.
- **Button**: GPIO12 — internal pull-up, inverted (active low), no debounce filter (immediate response)
- **RGB LED**: GPIO14 (red), GPIO27 (green), GPIO26 (blue) — LEDC PWM outputs with internal pull-down
- **Display**: SSD1306 128x64 OLED via I2C — GPIO16 (SDA), GPIO17 (SCL), address 0x3C (7-bit), 400kHz

## Fonts
- Both display fonts are **Oswald@300** (`gfonts://Oswald@300`)
- `font_small`: size 16 — top-row temperature/humidity
- `font_big`: size 32 — scrolling marquee

## LED Behavior
- **Standby (blinking=false, cleared=false)**: dim blue — `brightness: 20%`, blue only, no transition
- **Cleared / sleep (blinking=false, cleared=true)**: half-brightness blue — `brightness: 10%` (about half of standby)
- **Blinking (blinking=true)**: 1s interval toggling red on/off via direct `set_level()` on LEDC outputs (bypasses light component to avoid log spam)
- **Boot**: sets standby blue at priority -10 (only if not blinking); brightness is 10% when the restored state is cleared, else 20%
- Standby/cleared LED is driven from a lambda via the `LightCall` C++ API (`id(rgb_led).turn_on()...`) so brightness can be chosen conditionally
- `default_transition_length: 0s` on the light component to avoid slow fades

## Display Layout
Two layouts, selected by the `cleared` global:

**Normal (`cleared=false`)** — used while armed and while normally disarmed:
- Top row: temperature (left, `%.1f°C`) and humidity (right, `%.0f%%`) in `font_small`, drawn with `printf()`
- No separator line (removed)
- Marquee text at y=16 in `font_big`, drawn with `print()` (avoids format-string issues with user text)
- Text width measured with `get_text_bounds()`: if it fits (`tw <= 128`) it is drawn statically at x=0; otherwise it scrolls, resetting `scroll_x` to 128 once it fully exits at `-tw`

**Cleared / sleep (`cleared=true`)** — no message, just the environment:
- Large centered temperature at y=0 and humidity at y=32, both in `font_big` (`TextAlign::TOP_CENTER`, x=64)

- `update_interval: 50ms` (20fps), 1px scroll step per frame

## Globals
- `blinking` (bool): LED blink state (armed) — persisted via raw NVS
- `blink_state` (bool): tracks current on/off phase within blink cycle
- `cleared` (bool): "sleep" sub-state of disarmed — dims LED to 10% and shows the message-free large temp/humidity layout — persisted via raw NVS. Always `false` while `blinking` is true.
- `scroll_text` (std::string): current marquee text, default "Boo!" — persisted via raw NVS
- `scroll_x` (int): current scroll pixel offset, resets to 128 on text change
- `boot_count` (int): increments each boot — persisted via ESPHome `restore_value`
- `boot_init` (bool): true during boot, set to false ~200ms after `on_boot`. Guards the text `on_value` handler so restoring `scroll_text` on boot does not spuriously set `blinking=true`.

## Boot / Stability
- `on_boot` priority 600 disables both core watchdog timers (`disableCore0WDT()` / `disableCore1WDT()`) — the 50ms display refresh + I2C transfers can otherwise trip the task WDT
- `on_boot` priority -10 logs the reset reason (`esp_reset_reason()`) for crash diagnosis, then restores NVS state
- `api:` has `reboot_timeout: 0s` so the device does not reboot when the API/HA connection drops

## Boot Count Sensor
- Template sensor `boot_count_sensor` uses `update_interval: never` to avoid periodic log spam
- `publish_state` is called once in the `on_boot` lambda immediately after incrementing
- The sensor value is served by the ESPHome web server at `GET /sensor/Boot%20Count` indefinitely until the next boot

## State Persistence (NVS)
ESPHome's `restore_value` is broken for `std::string` globals (silently fails even with `max_restore_data_length`). It works for `int` and `bool` but bool had issues with `on_value` callbacks overwriting during boot.

**Solution**: Use raw ESP-IDF NVS API (`nvs_open`/`nvs_get_str`/`nvs_set_str`/`nvs_get_u8`/`nvs_set_u8`) via `nvs_helper.h` include. Namespace: `"boo"`, keys: `"text"`, `"blinking"`, `"cleared"`.

**Boot sequence** (`on_boot` priority -10):
1. Globals initialize with defaults; `boot_init` starts `true`
2. Increment/publish `boot_count`, log reset reason
3. Read `text`, `blinking`, and `cleared` from NVS into their globals
4. `publish_state(scroll_text)` syncs the text entity for the web UI — this fires `on_value`, but the handler is a no-op for `blinking` because `boot_init` is still `true` (and the value is unchanged)
5. After a 200ms delay, `boot_init = false`
6. LED set to standby blue only if `!blinking` — 10% if `cleared`, else 20%

**Write points**: `on_value` (text change, once `!boot_init`) saves text + blinking=1 + cleared=0; button `on_press` saves the resulting blinking + cleared values.

## Interaction Flow
Three states: **armed** (`blinking`), **disarmed** (`!blinking && !cleared`), **cleared/sleep** (`!blinking && cleared`).

- **Text changed** (via web API or HA): sets `scroll_text`, resets `scroll_x` to 128, sets `blinking = true` and `cleared = false` — a new message always re-arms and returns to the message display, regardless of whether the device was disarmed or cleared
- **Button pressed**:
  - if **armed** → disarm: `blinking = false`, `cleared = false`, LED standby blue (20%), message shown
  - if **disarmed** (not cleared) → enter cleared/sleep: `cleared = true`, LED dims to 10%, display shows large temp/humidity only
  - if **cleared** → toggle back to normal disarmed: `cleared = false`, LED back to 20%, message shown again

## ESPHome Web Interface
- Web server on port 80
- Text entity "Scroll Text" exposed — change via `POST /text/Scroll%20Text/set?value=...` (requires `Content-Length: 0` header)
- Binary sensor "Blinking" exposed — read via `GET /binary_sensor/Blinking` (template sensor wrapping the `blinking` global)
- Sensor "Boot Count" exposed — read via `GET /sensor/Boot%20Count` (published once on boot)
- Sensor "Temperature" exposed — read via `GET /sensor/Temperature`
- Sensor "Humidity" exposed — read via `GET /sensor/Humidity`
- Uses entity name URLs (not object ID URLs, deprecated in ESPHome 2026.7.0)
- Also has captive portal for WiFi fallback AP

## Proxy Server (`server/`)
Hono app running on Bun, proxies to the ESP32 and adds webhook support.

### Stack
- **Runtime**: Bun
- **Framework**: Hono
- **Database**: `bun:sqlite` (built-in), stored at `./data/webhooks.db`

### Config (env vars)
- `ESPHOME_HOST` — default `http://boo-display.local`
- `PORT` — default `3000`
- `DB_PATH` — default `./data/webhooks.db`
- `POLL_INTERVAL` — default `10000` (ms)
- `BEARER_TOKEN` — if set, all non-OPTIONS requests require `Authorization: Bearer <token>` header. CORS preflight is always allowed through.
- `HA_TOKEN` — Home Assistant long-lived access token. Required (with `HA_URL`) to fire HA events.
- `HA_URL` — Home Assistant notify service URL (e.g. `https://ha.example.com/api/services/notify/devices`). Base URL is extracted to derive the events endpoint.

### Endpoints

> **Important**: Any change to server endpoints (additions, removals, changed responses or errors) must be reflected in `server/README.md`.

> **Timestamps**: All timestamps in API responses and requests must be ISO 8601 format (e.g., `"2026-02-24T12:00:00.000Z"`). Convert from/to database datetime format as needed.



#### `POST /text`
Set scroll text (plaintext body). Fires `armed` webhook and `boo_display` HA event with `cause: "text_changed"`.
- **Success** `200`: `{"ok": true, "text": "Hello"}`
- **Error** `400`: `{"error": "Body must contain text"}`
- **Error** `502`: `{"error": "Device unreachable"}` or `{"error": "Failed to set text", "status": 503}`

#### `GET /text`
Returns the last text set via this server, stored in the database.
- **Success** `200`: `{"text": "Hello", "set_at": "2026-02-24T12:00:00.000Z"}`
- **Error** `400`: `{"error": "Last set text unknown"}` (no text has been set)

#### `GET /alarm`
Returns current blinking state from the device.
- **Success** `200`: `{"armed": true}`
- **Error** `502`: `{"error": "Device unreachable"}` or `{"error": "Failed to read alarm state", "status": 503}`

#### `GET /health`
Fetches boot count, temperature, and humidity from the device. Reports average round-trip time of the three sensor fetches.
- **Success** `200`: `{"boot_count": 42, "temperature_c": 21.0, "humidity_pct": 55.0, "rtt_ms": 38, "server_git_sha": "abc1234...", "server_started_at": "2026-02-24T12:00:00.000Z"}`
- **Error** `502`:
  ```json
  {
    "error": "Device unreachable or returned an error",
    "rtt_ms": 2001,
    "details": {
      "boot_count": {"ok": false, "error": "Device unreachable"},
      "temperature": {"ok": true, "value": 21.0},
      "humidity": {"ok": false, "error": "Device error", "status": 503}
    }
  }
  ```

#### `GET /webhooks`
List all registered webhook URLs.
- **Success** `200`: `{"webhooks": [{"id": 1, "url": "https://...", "created_at": "2026-02-24T12:00:00.000Z"}]}`

#### `POST /webhooks`
Register a webhook URL (`{"url": "..."}`).
- **Success** `200`: `{"ok": true, "id": 1, "url": "https://..."}`
- **Error** `400`: `{"error": "Body must contain a 'url' string"}`
- **Error** `409`: `{"error": "Webhook URL already registered"}`

#### `DELETE /webhooks`
Remove a webhook URL (`{"url": "..."}`).
- **Success** `200`: `{"ok": true}`
- **Error** `400`: `{"error": "Body must contain a 'url' string"}`
- **Error** `404`: `{"error": "Webhook URL not found"}`

### Polling
- Baseline: `pollBlinking()` runs every `POLL_INTERVAL` (default 10s), reading `GET /binary_sensor/Blinking`, and tracks `deviceOnline` + `lastBlinking`.
- **Adaptive fast polling**: `POST /text` sets `armedAt` and starts a fast-poll loop that tightens the interval after arming — 100ms for the first minute, 500ms for the next 5 minutes, 1s for the next 10 minutes, then reverts to the baseline (~16 min total). This detects a disarm (button press) quickly. `lastBlinking` is set to `true` on `POST /text` so the on→off transition is always caught.

### Webhook Events
- `{"event": "armed", "text": "..."}` — fired on `POST /text`
- `{"event": "disarmed"}` — fired when polling detects blinking transition from on→off
- `{"event": "online"}` — fired when device becomes reachable after being offline
- `{"event": "offline"}` — fired when device becomes unreachable after being online
- `{"event": "server_restart"}` — fired once on server startup
- Dispatch is fire-and-forget via `Promise.allSettled`

### Home Assistant Integration
- The server fires custom `boo_display` events to HA via `POST /api/events/boo_display` (requires `HA_TOKEN` + `HA_URL`)
- Event data includes: `cause`, `timestamp`, `device_online`, `last_blinking`, `server_started_at`, plus cause-specific fields (e.g. `text` for `text_changed`)
- Currently fired on `POST /text` with `cause: "text_changed"`
- The HA automation `automation.boo_display_reaction` listens for `boo_display` events and dispatches actions based on `trigger.event.data.cause`
- Notifications (previously sent directly by the server via `notify.markus_devices`) are now handled entirely by this HA automation

### Authentication
- Bearer token auth is handled by the server itself (not Caddy) via `BEARER_TOKEN` env var
- CORS middleware runs before auth so OPTIONS preflight requests pass without credentials
- This was moved from Caddy to the server to fix CORS preflight 401 errors from the web app

### Deployment
- **Image**: `ghcr.io/mtib/boo_display/server:latest` — built by GitHub Actions on push to `server/`, also manually triggerable
- **Public URL**: `https://api.display.boo.mtib.dev` — Caddy reverse proxy (auth now in server, not Caddy)
- **Container needs `ESPHOME_HOST` set to the device IP** — mDNS (`.local`) doesn't work inside Docker
- Local: `cd server && bun install && bun run index.ts`

## Web App (`web/`)
Mobile-first React SPA for controlling the Boo Display, deployed as a PWA to GitHub Pages.

### Stack
- **Runtime**: Bun
- **Framework**: React 19 + TypeScript
- **UI Library**: Mantine 7 (dark mode by default)
- **Build**: Vite with `vite-plugin-pwa`
- **Deploy**: GitHub Actions → GitHub Pages

### Features
- **Dashboard**: health card (temperature, humidity, boot count, RTT), alarm status badge, current display text, text input to send new messages
- **Auto-refresh**: polls all endpoints every 30 seconds
- **Fast alarm polling**: after sending text, polls `GET /alarm` on a tightening schedule (200ms first minute, 3s for 5 min, 10s for 10 min) so the disarm shows up quickly; stops and does a full refresh once `armed` goes false
- **PWA**: installable, service worker with `skipWaiting` + `clientsClaim` for immediate updates
- **Ghost mascot icon**: custom SVG-based favicon and PWA icons

### Authentication
- Bearer token stored in URL hash (`#token`) and persisted to `localStorage`
- On fresh open: reads from `localStorage`, restores hash — no dialog needed
- First visit (no hash, no localStorage): shows undismissable modal dialog for token entry
- Token changes happen by navigating to a URL with a different hash

### API Client (`web/src/api.ts`)
- Base URL: `https://api.display.boo.mtib.dev`
- Methods: `getHealth()`, `getText()`, `setText(text)`, `getAlarm()`
- Reads token from `window.location.hash` for `Authorization: Bearer` header

### Deployment
- **URL**: `https://boo-display.mtib.dev`
- **CNAME**: `web/public/CNAME` → `boo-display.mtib.dev`
- **CI**: `.github/workflows/web-pages.yml` — triggers on push to `web/` on main, or manual dispatch
- **Build**: `bun install --frozen-lockfile && bun run build`
- Local: `cd web && bun install && bun run dev`

### Key Files
- `web/src/App.tsx` — auth gate, token management, app shell
- `web/src/components/Dashboard.tsx` — main dashboard with all cards
- `web/src/components/TokenDialog.tsx` — token entry modal
- `web/src/api.ts` — typed API client
- `web/vite.config.ts` — Vite + PWA config

## Secrets (gitignored)
- `wifi_ssid`, `wifi_password`: WiFi credentials
- `ota_password`, `ap_password`: OTA and fallback AP passwords

## Flashing
- `esphome run boo_display.yaml --no-logs` — compile and flash via OTA
- `esphome logs boo_display.yaml` — view device logs

## Performance Notes
- I2C at 400kHz (SSD1306 max) eliminates screen tearing
- 50ms display interval is near practical max (~23ms per full frame transfer)
- Blink uses direct LEDC `set_level()` instead of `light.control` to avoid repeated debug log entries
