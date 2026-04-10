import { useState, useEffect, useCallback } from "react";
import { AppShell, Group, Title, ActionIcon, Text } from "@mantine/core";
import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { Dashboard } from "./components/Dashboard";
import { TokenDialog } from "./components/TokenDialog";

function getTokenFromHash(): string {
  return decodeURIComponent(window.location.hash.slice(1));
}

export function App() {
  const [token, setToken] = useState(getTokenFromHash);
  const [dialogOpen, setDialogOpen] = useState(!token);

  useEffect(() => {
    const onHashChange = () => {
      const t = getTokenFromHash();
      setToken(t);
      if (!t) setDialogOpen(true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleTokenSubmit = useCallback((newToken: string) => {
    window.location.hash = encodeURIComponent(newToken);
    setToken(newToken);
    setDialogOpen(false);
  }, []);

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={3}>Boo Display</Title>
          <Group gap="xs">
            {token && (
              <Text size="xs" c="dimmed">
                authenticated
              </Text>
            )}
            <ActionIcon
              variant="subtle"
              onClick={() => {
                if (token) {
                  window.location.hash = "";
                  setToken("");
                  setDialogOpen(true);
                } else {
                  setDialogOpen(true);
                }
              }}
              title={token ? "Change token" : "Set token"}
            >
              {token ? <IconLock size={20} /> : <IconLockOpen size={20} />}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {token ? (
          <Dashboard />
        ) : (
          <Text c="dimmed" ta="center" mt="xl">
            Please enter your API token to continue.
          </Text>
        )}
      </AppShell.Main>

      <TokenDialog
        opened={dialogOpen}
        onSubmit={handleTokenSubmit}
        onClose={() => {
          if (token) setDialogOpen(false);
        }}
      />
    </AppShell>
  );
}
