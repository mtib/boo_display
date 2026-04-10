import { useState, useEffect, useCallback } from "react";
import {
  SimpleGrid,
  Card,
  Text,
  Group,
  Badge,
  TextInput,
  Button,
  Stack,
  Loader,
  Alert,
} from "@mantine/core";
import {
  IconTemperature,
  IconDroplet,
  IconBell,
  IconBellOff,
  IconRefresh,
  IconSend,
  IconServer,
  IconAlertCircle,
} from "@tabler/icons-react";
import {
  getHealth,
  getText,
  getAlarm,
  setText,
  type HealthResponse,
  type TextResponse,
  type AlarmResponse,
  ApiError,
} from "../api";

const REFRESH_INTERVAL = 30_000;

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Group gap="xs">
      {icon}
      <div>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text fw={600}>{value}</Text>
      </div>
    </Group>
  );
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [text, setTextState] = useState<TextResponse | null>(null);
  const [alarm, setAlarm] = useState<AlarmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [h, t, a] = await Promise.allSettled([
        getHealth(),
        getText(),
        getAlarm(),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (t.status === "fulfilled") setTextState(t.value);
      if (a.status === "fulfilled") setAlarm(a.value);

      const firstError = [h, t, a].find((r) => r.status === "rejected");
      if (firstError && firstError.status === "rejected") {
        const err = firstError.reason;
        if (err instanceof ApiError && err.status === 401) {
          setError("Invalid token. Tap the lock icon to re-enter.");
        } else if (
          [h, t, a].every((r) => r.status === "rejected")
        ) {
          setError(
            err instanceof Error ? err.message : "Failed to reach server",
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  const handleSend = async () => {
    if (!newText.trim()) return;
    setSending(true);
    try {
      await setText(newText.trim());
      setNewText("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send text");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  return (
    <Stack gap="md">
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {/* Health Card */}
        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Device Health</Text>
            <IconRefresh
              size={18}
              style={{ cursor: "pointer" }}
              onClick={refresh}
            />
          </Group>
          {health ? (
            <SimpleGrid cols={2} spacing="sm">
              <Stat
                icon={<IconTemperature size={20} color="var(--mantine-color-orange-5)" />}
                label="Temperature"
                value={`${health.temperature_c.toFixed(1)} °C`}
              />
              <Stat
                icon={<IconDroplet size={20} color="var(--mantine-color-blue-5)" />}
                label="Humidity"
                value={`${health.humidity_pct.toFixed(0)}%`}
              />
              <Stat
                icon={<IconServer size={20} color="var(--mantine-color-gray-5)" />}
                label="Boot Count"
                value={String(health.boot_count)}
              />
              <Stat
                icon={<IconServer size={20} color="var(--mantine-color-gray-5)" />}
                label="RTT"
                value={`${health.rtt_ms} ms`}
              />
            </SimpleGrid>
          ) : (
            <Text c="dimmed" size="sm">
              No data
            </Text>
          )}
        </Card>

        {/* Alarm Card */}
        <Card withBorder>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Alarm</Text>
            {alarm?.armed ? (
              <Badge color="red" variant="light" leftSection={<IconBell size={14} />}>
                Armed
              </Badge>
            ) : (
              <Badge
                color="green"
                variant="light"
                leftSection={<IconBellOff size={14} />}
              >
                Disarmed
              </Badge>
            )}
          </Group>
          {text && (
            <>
              <Text size="sm" c="dimmed">
                Current text
              </Text>
              <Text size="lg" fw={500} mt={4}>
                {text.text}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                Set {new Date(text.set_at).toLocaleString()}
              </Text>
            </>
          )}
        </Card>
      </SimpleGrid>

      {/* Send Text Card */}
      <Card withBorder>
        <Text fw={600} mb="sm">
          Set Display Text
        </Text>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <Group align="end">
            <TextInput
              placeholder="Enter text to display..."
              value={newText}
              onChange={(e) => setNewText(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              type="submit"
              loading={sending}
              disabled={!newText.trim()}
              leftSection={<IconSend size={16} />}
            >
              Send
            </Button>
          </Group>
        </form>
      </Card>
    </Stack>
  );
}
