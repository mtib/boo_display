const BASE_URL = "https://api.display.boo.mtib.dev";

export interface HealthResponse {
  boot_count: number;
  temperature_c: number;
  humidity_pct: number;
  rtt_ms: number;
  server_git_sha: string;
  server_started_at: string;
}

export interface HealthErrorResponse {
  error: string;
  rtt_ms: number;
  details: Record<
    string,
    { ok: true; value: number } | { ok: false; error: string; status?: number }
  >;
}

export interface TextResponse {
  text: string;
  set_at: string;
}

export interface AlarmResponse {
  armed: boolean;
}

export interface SetTextResponse {
  ok: boolean;
  text: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function getToken(): string {
  return decodeURIComponent(window.location.hash.slice(1));
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  const body = await res.json();

  if (!res.ok) {
    throw new ApiError(
      body.error || `Request failed with status ${res.status}`,
      res.status,
    );
  }

  return body as T;
}

export function getHealth() {
  return request<HealthResponse>("/health");
}

export function getText() {
  return request<TextResponse>("/text");
}

export function setText(text: string) {
  return request<SetTextResponse>("/text", {
    method: "POST",
    body: text,
  });
}

export function getAlarm() {
  return request<AlarmResponse>("/alarm");
}
