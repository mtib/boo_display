# Boo Display - Project Notes

## Overview
ESPHome project for ESP32 WROOM with a Hono/Bun proxy server. Config file: `boo_display.yaml`, secrets in `secrets.yaml` (gitignored). Server in `server/`.

## Hardware
- **Board**: ESP32 WROOM (`esp32dev`)
- **DHT11**: GPIO13 — temperature & humidity, 30s update interval
- **Button**: GPIO12 — internal pull-up, inverted (active low), no debounce filter (immediate response)
- **RGB LED**: GPIO14 (red), GPIO27 (green), GPIO26 (blue) — LEDC PWM outputs with internal pull-down
- **Display**: SSD1306 128x64 OLED via I2C — GPIO16 (SDA), GPIO17 (SCL), address 0x3C (7-bit), 400kHz

## LED Behavior
- **Standby (blinking=false)**: dim blue — `brightness: 10%`, blue only, no transition
- **Blinking (blinking=true)**: 1s interval toggling red on/off via direct `set_level()` on LEDC outputs (bypasses light component to avoid log spam)
- **Boot**: sets standby blue via `light.control` at priority -10
- `default_transition_length: 0s` on the light component to avoid slow fades

## Display Layout
- Top row: temperature (left) and humidity (right) in `font_small` (Roboto 12px)
- Horizontal separator line at y=14
- Scrolling marquee text at y=24 in `font_big` (Roboto 32px)
- `update_interval: 50ms` (20fps), 1px scroll step per frame
- Text width measured with `get_text_bounds()` for correct wrapping of any length
- Uses `print()` not `printf()` to avoid format string issues with user text

## Globals
- `blinking` (bool): LED blink state — persisted via raw NVS
- `blink_state` (bool): tracks current on/off phase within blink cycle
- `scroll_text` (std::string): current marquee text, default "Boo!" — persisted via raw NVS
- `scroll_x` (int): current scroll pixel offset, resets to 128 on text change
- `boot_count` (int): increments each boot — persisted via ESPHome `restore_value`

## Boot Count Sensor
- Template sensor `boot_count_sensor` uses `update_interval: never` to avoid periodic log spam
- `publish_state` is called once in the `on_boot` lambda immediately after incrementing
- The sensor value is served by the ESPHome web server at `GET /sensor/Boot%20Count` indefinitely until the next boot

## State Persistence (NVS)
ESPHome's `restore_value` is broken for `std::string` globals (silently fails even with `max_restore_data_length`). It works for `int` and `bool` but bool had issues with `on_value` callbacks overwriting during boot.

**Solution**: Use raw ESP-IDF NVS API (`nvs_open`/`nvs_get_str`/`nvs_set_str`/`nvs_get_u8`/`nvs_set_u8`) via `nvs_helper.h` include. Namespace: `"boo"`, keys: `"text"`, `"blinking"`.

**Boot sequence**:
1. Globals initialize with defaults
2. `on_boot` (priority -10) reads `text` and `blinking` from NVS
3. `publish_state` syncs the text entity for the web UI (triggers `on_value` which sets `blinking=true`)
4. `blinking` is restored from saved value after `publish_state`
5. LED state set based on restored `blinking`

**Write points**: `on_value` (text change) saves text + blinking=1, button `on_press` saves blinking=0.

## Interaction Flow
- **Text changed** (via web API or HA): sets `scroll_text`, resets `scroll_x` to 128, sets `blinking = true`
- **Button pressed**: always sets `blinking = false`, resets `blink_state`, returns LED to standby blue

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

### Endpoints

> **Important**: Any change to server endpoints (additions, removals, changed responses or errors) must be reflected in `server/README.md`.



#### `POST /text`
Set scroll text (plaintext body). Fires `armed` webhook.
- **Success** `200`: `{"ok": true, "text": "Hello"}`
- **Error** `400`: `{"error": "Body must contain text"}`
- **Error** `502`: `{"error": "Device unreachable"}` or `{"error": "Failed to set text", "status": 503}`

#### `GET /text`
Returns the last text set via this server (in-memory, resets on server restart).
- **Success** `200`: `{"text": "Hello"}`

#### `GET /alarm`
Returns current blinking state from the device.
- **Success** `200`: `{"armed": true}`
- **Error** `502`: `{"error": "Device unreachable"}` or `{"error": "Failed to read alarm state", "status": 503}`

#### `GET /health`
Fetches boot count, temperature, and humidity from the device. Reports round-trip time.
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
- **Success** `200`: `{"webhooks": [{"id": 1, "url": "https://...", "created_at": "2026-02-24 12:00:00"}]}`

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

### Webhook Events
- `{"event": "armed", "text": "..."}` — fired on `POST /text`
- `{"event": "disarmed"}` — fired when polling detects blinking transition from on→off (polled every 10s)
- `{"event": "online"}` — fired when device becomes reachable after being offline
- `{"event": "offline"}` — fired when device becomes unreachable after being online
- `{"event": "server_restart"}` — fired once on server startup
- Dispatch is fire-and-forget via `Promise.allSettled`

### Deployment
- **Image**: `ghcr.io/mtib/boo_display/server:latest` — built by GitHub Actions on push to `server/`, also manually triggerable
- **Public URL**: `https://api.display.boo.mtib.dev` — Caddy reverse proxy with bearer token auth
- **Container needs `ESPHOME_HOST` set to the device IP** — mDNS (`.local`) doesn't work inside Docker
- Local: `cd server && bun install && bun run index.ts`

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
