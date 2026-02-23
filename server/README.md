# Boo Display Server

HTTP server that proxies requests to the ESP32 ESPHome device and provides webhook notifications for alarm state changes.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `ESPHOME_HOST` | `http://boo-display.local` | ESPHome device URL |
| `PORT` | `3000` | Server listen port |
| `DB_PATH` | `./data/webhooks.db` | SQLite database path |
| `POLL_INTERVAL` | `10000` | Blinking poll interval in ms |

## Endpoints

### `POST /text`

Set the scroll text on the display. Fires an `armed` webhook event.

```sh
curl -X POST http://localhost:3000/text -d "Hello World"
```

Response: `{"ok": true, "text": "Hello World"}`

### `GET /text`

Get the last text that was set via the server.

```sh
curl http://localhost:3000/text
```

Response: `{"text": "Hello World"}`

### `GET /alarm`

Get the current alarm (blinking) state from the device.

```sh
curl http://localhost:3000/alarm
```

Response: `{"armed": true}`

### `GET /webhooks`

List all registered webhooks.

```sh
curl http://localhost:3000/webhooks
```

Response: `{"webhooks": [{"id": 1, "url": "https://example.com/hook", "created_at": "2026-02-23 12:00:00"}]}`

### `POST /webhooks`

Register a webhook URL.

```sh
curl -X POST http://localhost:3000/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/hook"}'
```

Response: `{"ok": true, "id": 1, "url": "https://example.com/hook"}`

Returns `409` if the URL is already registered.

### `DELETE /webhooks`

Remove a registered webhook URL.

```sh
curl -X DELETE http://localhost:3000/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/hook"}'
```

Response: `{"ok": true}`

Returns `404` if the URL is not found.

## Webhook payloads

Webhooks receive a POST with `Content-Type: application/json`.

**Alarm armed** (triggered when text is set via `POST /text`):
```json
{"event": "armed", "text": "Hello World"}
```

**Alarm disarmed** (triggered when blinking transitions from on to off, polled every 10s):
```json
{"event": "disarmed"}
```

## Running

```sh
bun install
bun run index.ts
```

## Docker

A prebuilt image is published to GitHub Container Registry on every push to `main` that changes `server/`:

```sh
docker pull ghcr.io/mtib/boo_display/server:latest
docker run -p 3000:3000 -v boo-data:/app/data ghcr.io/mtib/boo_display/server:latest
```

To build locally:

```sh
docker build -t boo-server .
docker run -p 3000:3000 -v boo-data:/app/data boo-server
```
