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

Top row shows temperature and humidity side by side, separated by a horizontal line. Below, a large scrolling marquee displays configurable text (defaults to "Boo!"). Runs at 20fps with 1px scroll step for smooth animation. I2C runs at 400kHz (SSD1306 max) to avoid tearing.

## RGB LED

- **Standby**: dim blue (10% brightness)
- **Blinking**: 1s on/off red blink, triggered when scroll text is changed
- **Button**: always dismisses blinking and returns to standby blue

## Scroll Text API

The web server on port 80 exposes a text entity. Change the scroll text via:

```bash
curl -X POST "http://<device-ip>/text/scroll_text/set?value=Hello%20World!" -H "Content-Length: 0"
```

Changing the text automatically enables red blinking. Press the button to dismiss.
