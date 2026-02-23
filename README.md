# Boo Display

ESPHome project for an ESP32 WROOM dev board.

## Pin Mapping

| GPIO | Component | Notes |
|------|-----------|-------|
| GPIO13 | DHT11 | Temperature & humidity sensor |
| GPIO12 | Momentary button | Internal pull-up, active low |
| GPIO14 | RGB LED - Red | PWM output, internal pull-down |
| GPIO27 | RGB LED - Green | PWM output, internal pull-down |
| GPIO26 | RGB LED - Blue | PWM output, internal pull-down |
| GPIO16 | I2C SDA | SSD1306 128x64 OLED display |
| GPIO17 | I2C SCL | SSD1306 128x64 OLED display |

## I2C Display

The display uses address `0x3C` (7-bit). If your display shows `0x78` on the label, that's the 8-bit write address — ESPHome uses the 7-bit form (`0x78 >> 1 = 0x3C`). If nothing shows up, try `0x3D`.

## Setup

1. Install ESPHome: `pip install esphome`
2. WiFi credentials are in `secrets.yaml`
3. Flash: `esphome run boo_display.yaml`

## Display

Shows temperature, humidity, and button state. The RGB LED is controllable via Home Assistant or the ESPHome API.
