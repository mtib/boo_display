import { Hono } from "hono";
import { cors } from "hono/cors";
import { Database } from "bun:sqlite";

const app = new Hono();
app.use("*", cors());

const ESPHOME_HOST = process.env.ESPHOME_HOST || "http://boo-display.local";
const PORT = parseInt(process.env.PORT || "3000", 10);
const DB_PATH = process.env.DB_PATH || "./data/webhooks.db";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "10000", 10);
const DEVICE_TIMEOUT = 2000;

// --- Database setup ---

import { mkdirSync } from "fs";
import { dirname } from "path";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode=WAL");
db.run(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// --- Webhook dispatch ---

function getWebhookUrls(): string[] {
  return db.query("SELECT url FROM webhooks").all().map((r: any) => r.url);
}

function fireWebhooks(payload: Record<string, unknown>) {
  const urls = getWebhookUrls();
  if (urls.length === 0) return;

  const body = JSON.stringify(payload);
  console.log(`Firing webhooks to ${urls.length} URL(s): ${JSON.stringify(payload)}`);

  Promise.allSettled(
    urls.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
    )
  ).then((results) => {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        console.error(`Webhook ${urls[i]} failed: ${r.reason}`);
      }
    }
  });
}

// --- State ---

let lastBlinking: boolean | null = null;
let lastText: string = "";
let deviceOnline: boolean | null = null;

// --- Polling ---

async function pollBlinking() {
  try {
    const res = await fetch(`${ESPHOME_HOST}/binary_sensor/Blinking`, { signal: AbortSignal.timeout(DEVICE_TIMEOUT) });
    if (!res.ok) {
      if (deviceOnline !== false) {
        deviceOnline = false;
        fireWebhooks({ event: "offline" });
      }
      return;
    }

    if (deviceOnline !== true) {
      deviceOnline = true;
      fireWebhooks({ event: "online" });
    }

    const data = await res.json();
    const current = data.value as boolean;

    if (lastBlinking === true && current === false) {
      fireWebhooks({ event: "disarmed" });
    }
    lastBlinking = current;
  } catch (e) {
    console.error("Poll error:", e);
    if (deviceOnline !== false) {
      deviceOnline = false;
      fireWebhooks({ event: "offline" });
    }
  }
}

fireWebhooks({ event: "server_restart" });
setInterval(pollBlinking, POLL_INTERVAL);
pollBlinking();

// --- Endpoints ---

app.post("/text", async (c) => {
  const text = await c.req.text();
  if (!text) {
    return c.json({ error: "Body must contain text" }, 400);
  }

  const url = `${ESPHOME_HOST}/text/Scroll%20Text/set?value=${encodeURIComponent(text)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Length": "0" },
      signal: AbortSignal.timeout(DEVICE_TIMEOUT),
    });
  } catch {
    return c.json({ error: "Device unreachable" }, 502);
  }

  if (!res.ok) {
    return c.json({ error: "Failed to set text", status: res.status }, 502);
  }

  lastText = text;
  fireWebhooks({ event: "armed", text });

  return c.json({ ok: true, text });
});

app.get("/text", (c) => {
  return c.json({ text: lastText });
});

app.get("/alarm", async (c) => {
  const url = `${ESPHOME_HOST}/binary_sensor/Blinking`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DEVICE_TIMEOUT) });
  } catch {
    return c.json({ error: "Device unreachable" }, 502);
  }

  if (!res.ok) {
    return c.json({ error: "Failed to read alarm state", status: res.status }, 502);
  }

  const data = await res.json();
  return c.json({ armed: data.value });
});

app.get("/health", async (c) => {
  const start = Date.now();
  type SensorResult =
    | { ok: true; value: number }
    | { ok: false; error: string; status?: number };

  async function fetchSensor(path: string): Promise<SensorResult> {
    let res: Response;
    try {
      res = await fetch(`${ESPHOME_HOST}${path}`, {
        signal: AbortSignal.timeout(DEVICE_TIMEOUT),
      });
    } catch {
      return { ok: false, error: "Device unreachable" };
    }
    if (!res.ok) {
      return { ok: false, error: "Device error", status: res.status };
    }
    const data = await res.json();
    return { ok: true, value: data.value as number };
  }

  const [bootCountResult, temperatureResult, humidityResult] =
    await Promise.all([
      fetchSensor("/sensor/Boot%20Count"),
      fetchSensor("/sensor/Temperature"),
      fetchSensor("/sensor/Humidity"),
    ]);

  const rtt = Date.now() - start;

  if (!bootCountResult.ok || !temperatureResult.ok || !humidityResult.ok) {
    return c.json(
      {
        error: "Device unreachable or returned an error",
        rtt_ms: rtt,
        details: {
          boot_count: bootCountResult,
          temperature: temperatureResult,
          humidity: humidityResult,
        },
      },
      502
    );
  }

  return c.json({
    boot_count: bootCountResult.value,
    temperature_c: temperatureResult.value,
    humidity_pct: humidityResult.value,
    rtt_ms: rtt,
  });
});

// --- Webhook management ---

app.get("/webhooks", (c) => {
  const webhooks = db.query("SELECT id, url, created_at FROM webhooks ORDER BY id").all();
  return c.json({ webhooks });
});

app.post("/webhooks", async (c) => {
  const body = await c.req.json();
  const url = body?.url;
  if (!url || typeof url !== "string") {
    return c.json({ error: "Body must contain a 'url' string" }, 400);
  }

  try {
    const result = db.run("INSERT INTO webhooks (url) VALUES (?)", [url]);
    return c.json({ ok: true, id: Number(result.lastInsertRowid), url });
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return c.json({ error: "Webhook URL already registered" }, 409);
    }
    throw e;
  }
});

app.delete("/webhooks", async (c) => {
  const body = await c.req.json();
  const url = body?.url;
  if (!url || typeof url !== "string") {
    return c.json({ error: "Body must contain a 'url' string" }, 400);
  }

  const result = db.run("DELETE FROM webhooks WHERE url = ?", [url]);
  if (result.changes === 0) {
    return c.json({ error: "Webhook URL not found" }, 404);
  }

  return c.json({ ok: true });
});

console.log(`Boo Display server listening on port ${PORT}`);
console.log(`ESPHome host: ${ESPHOME_HOST}`);
console.log(`Polling interval: ${POLL_INTERVAL}ms`);
console.log(`Database: ${DB_PATH}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
