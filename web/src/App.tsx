import { useState, useEffect, useCallback } from "react";
import { AppShell, Group, Title } from "@mantine/core";
import { Dashboard } from "./components/Dashboard";
import { TokenDialog } from "./components/TokenDialog";

const STORAGE_KEY = "boo-display-token";

function getInitialToken(): string {
  // Hash takes priority (e.g. shared link)
  const hashToken = decodeURIComponent(window.location.hash.slice(1));
  if (hashToken) {
    localStorage.setItem(STORAGE_KEY, hashToken);
    return hashToken;
  }
  // Fall back to localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    // Restore hash so the app stays consistent
    window.location.hash = encodeURIComponent(stored);
    return stored;
  }
  return "";
}

export function App() {
  const [token, setToken] = useState(getInitialToken);
  const [dialogOpen, setDialogOpen] = useState(!token);

  useEffect(() => {
    const onHashChange = () => {
      const t = decodeURIComponent(window.location.hash.slice(1));
      if (t) {
        localStorage.setItem(STORAGE_KEY, t);
      }
      setToken(t);
      if (!t) setDialogOpen(true);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const handleTokenSubmit = useCallback((newToken: string) => {
    localStorage.setItem(STORAGE_KEY, newToken);
    window.location.hash = encodeURIComponent(newToken);
    setToken(newToken);
    setDialogOpen(false);
  }, []);

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Title order={3}>Boo Display</Title>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {token && <Dashboard />}
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
