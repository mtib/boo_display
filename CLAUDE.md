# Boo Display - Project Notes

## Overview
ESPHome project for ESP32 WROOM. Config file: `boo_display.yaml`, secrets in `secrets.yaml` (gitignored).

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
- `blinking` (bool): LED blink state
- `blink_state` (bool): tracks current on/off phase within blink cycle
- `scroll_text` (std::string): current marquee text, default "Boo!"
- `scroll_x` (int): current scroll pixel offset, resets to 128 on text change

## Interaction Flow
- **Text changed** (via web API or HA): sets `scroll_text`, resets `scroll_x` to 128, sets `blinking = true`
- **Button pressed**: always sets `blinking = false`, resets `blink_state`, returns LED to standby blue

## Web Interface
- Web server on port 80
- Text entity "Scroll Text" exposed — change via `POST /text/scroll_text/set?value=...` (requires `Content-Length: 0` header)
- Also has captive portal for WiFi fallback AP

## Secrets (gitignored)
- `wifi_ssid`, `wifi_password`: WiFi credentials
- `ota_password`, `ap_password`: OTA and fallback AP passwords

## Performance Notes
- I2C at 400kHz (SSD1306 max) eliminates screen tearing
- 50ms display interval is near practical max (~23ms per full frame transfer)
- Blink uses direct LEDC `set_level()` instead of `light.control` to avoid repeated debug log entries
