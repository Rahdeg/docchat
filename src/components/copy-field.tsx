"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

// A read-only value with a copy button (shadcn's input-group-button pattern), e.g. a URL or a
// command to paste elsewhere.
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (permissions, an insecure origin): the text is selectable instead.
    }
  }

  return (
    <InputGroup className="paper">
      <InputGroupInput
        readOnly
        value={value}
        aria-label={label}
        className="font-mono text-[13px]"
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
          title={copied ? "Copied" : "Copy"}
          onClick={copy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
