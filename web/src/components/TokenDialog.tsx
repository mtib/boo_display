import { useState } from "react";
import { Modal, TextInput, Button, Stack } from "@mantine/core";

interface TokenDialogProps {
  opened: boolean;
  onSubmit: (token: string) => void;
  onClose: () => void;
}

export function TokenDialog({ opened, onSubmit, onClose }: TokenDialogProps) {
  const [value, setValue] = useState("");

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="API Token"
      centered
      closeOnClickOutside={false}
      withCloseButton={false}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) {
            onSubmit(value.trim());
            setValue("");
          }
        }}
      >
        <Stack>
          <TextInput
            label="Bearer Token"
            placeholder="Paste your API token"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            autoFocus
            data-autofocus
          />
          <Button type="submit" disabled={!value.trim()}>
            Connect
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
