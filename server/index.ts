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
const SERVER_STARTED_AT = new Date().toISOString();
const HA_TOKEN = process.env.HA_TOKEN;
const HA_URL = process.env.HA_URL;

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
db.run(`
  CREATE TABLE IF NOT EXISTS text_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    set_at TEXT DEFAULT (datetime('now'))
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

function sendHANotification(text: string) {
  if (!HA_TOKEN || !HA_URL) return;

  fetch(HA_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: text,
      title: "Boo display text changed",
      data: {
        channel: "Boo change",
      },
    }),
  }).catch((err) => {
    console.error("Failed to send Home Assistant notification:", err);
  });
}

// --- State ---

let lastBlinking: boolean | null = null;
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

  db.run("INSERT INTO text_history (text) VALUES (?)", [text]);
  fireWebhooks({ event: "armed", text });
  sendHANotification(text);

  return c.json({ ok: true, text });
});

app.get("/text", (c) => {
  const row = db.query("SELECT text, set_at FROM text_history ORDER BY id DESC LIMIT 1").get() as any;
  if (!row) {
    return c.json({ error: "Last set text unknown" }, 400);
  }
  const isoDate = new Date(row.set_at).toISOString();
  return c.json({ text: row.text, set_at: isoDate });
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
  type SensorResult =
    | { ok: true; value: number; rtt: number }
    | { ok: false; error: string; status?: number; rtt: number };

  async function fetchSensor(path: string): Promise<SensorResult> {
    const start = Date.now();
    let res: Response;
    try {
      res = await fetch(`${ESPHOME_HOST}${path}`, {
        signal: AbortSignal.timeout(DEVICE_TIMEOUT),
      });
    } catch {
      return { ok: false, error: "Device unreachable", rtt: Date.now() - start };
    }
    if (!res.ok) {
      return { ok: false, error: "Device error", status: res.status, rtt: Date.now() - start };
    }
    const data = await res.json();
    return { ok: true, value: data.value as number, rtt: Date.now() - start };
  }

  const [bootCountResult, temperatureResult, humidityResult] =
    await Promise.all([
      fetchSensor("/sensor/Boot%20Count"),
      fetchSensor("/sensor/Temperature"),
      fetchSensor("/sensor/Humidity"),
    ]);

  const rtt = Math.round((bootCountResult.rtt + temperatureResult.rtt + humidityResult.rtt) / 3);

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
    server_git_sha: process.env.GIT_SHA ?? "unknown",
    server_started_at: SERVER_STARTED_AT,
  });
});

// --- Webhook management ---

app.get("/webhooks", (c) => {
  const webhooks = db.query("SELECT id, url, created_at FROM webhooks ORDER BY id").all() as any[];
  const formattedWebhooks = webhooks.map((w) => ({
    id: w.id,
    url: w.url,
    created_at: new Date(w.created_at).toISOString(),
  }));
  return c.json({ webhooks: formattedWebhooks });
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
console.log(`Git SHA: ${process.env.GIT_SHA ?? "unknown"}`);
if (HA_TOKEN && HA_URL) {
  console.log(`Home Assistant notifications enabled: ${HA_URL}`);
}

export default {
  port: PORT,
  fetch: app.fetch,
};
