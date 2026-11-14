"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { showLimitToast } from "@/components/limit-toast";
import { limitMessage } from "@/lib/limit-messages";

import { findDuplicate, registerDocument, uploadLimitReason } from "../actions";
import {
  buildBlobPathname,
  checkFile,
  contentMatchesKind,
  contentMismatchMessage,
  type FileKind,
  fileKinds,
  SNIFF_BYTES,
  type UploadLimits,
} from "../upload-rules";

// Files that go up at the same time; the rest wait their turn.
const CONCURRENCY = 2;
// Blob splits files above this into parts that upload in parallel and retry on their own.
const MULTIPART_ABOVE = 5 * 1024 * 1024;

export type UploadState = "waiting" | "uploading" | "registering" | "failed";

export type UploadItem = {
  key: string;
  file: File;
  kind: FileKind;
  state: UploadState;
  // 0–100, while uploading.
  progress: number;
  error?: string;
  // Set once registered; the item disappears when that document shows up in the list.
  documentId?: string;
};

type UseUploadsOptions = {
  userId: string;
  // Where files go: straight to Vercel Blob, or (CI's end-to-end tests only) to our own route
  // for the local store (docs/adr/0009).
  storage?: "blob" | "local";
  // Documents the user already has, and the limits, for the client-side checks.
  documentCount: number;
  limits: UploadLimits;
  // Ids currently listed, so registered uploads hand over to their document row.
  listedIds: ReadonlySet<string>;
};

export function useUploads({
  userId,
  storage = "blob",
  documentCount,
  limits,
  listedIds,
}: UseUploadsOptions) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  // Files waiting for a free slot, and how many slots are in use.
  const waiting = useRef<UploadItem[]>([]);
  const running = useRef(0);

  const update = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }, []);

  const removeItem = useCallback((key: string) => {
    waiting.current = waiting.current.filter((item) => item.key !== key);
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      update(item.key, { state: "uploading", progress: 0 });

      try {
        const pathname = buildBlobPathname(userId, item.file.name, crypto.randomUUID());
        const contentType = fileKinds[item.kind].mimeType;
        const blob =
          storage === "local"
            ? await uploadLocal(pathname, item.file, contentType, controller.signal)
            : await upload(pathname, item.file, {
                access: "private",
                handleUploadUrl: "/api/documents/upload",
                contentType,
                multipart: item.file.size > MULTIPART_ABOVE,
                abortSignal: controller.signal,
                onUploadProgress: ({ percentage }) =>
                  update(item.key, { progress: Math.round(percentage) }),
              });
        controllers.current.delete(item.key);
        update(item.key, { state: "registering", progress: 100 });

        const result = await registerDocument({
          blobPathname: blob.pathname,
          name: item.file.name,
          mimeType: fileKinds[item.kind].mimeType,
          sizeBytes: item.file.size,
        });
        if (!result.ok) {
          update(item.key, { state: "failed", error: result.error });
          if (result.limit) showLimitToast(result.limit);
          else toast.error(result.error);
          return;
        }
        update(item.key, { documentId: result.data.id });
        router.refresh();
      } catch (error) {
        controllers.current.delete(item.key);
        if (controller.signal.aborted) return;
        console.error(error);
        // The token route's reason doesn't survive the Blob client: ask whether it was a limit
        // (documents or the upload rate), and otherwise keep this general.
        const limited = await uploadLimitReason({}).catch(() => null);
        const failure = limited?.ok ? limited.data : null;
        if (failure) {
          update(item.key, { state: "failed", error: limitMessage(failure) });
          showLimitToast(failure);
          return;
        }
        const message = `Couldn't upload ${item.file.name}. Check your connection and try again.`;
        update(item.key, { state: "failed", error: message });
        toast.error(message);
      }
    },
    [router, storage, update, userId],
  );

  // Starts waiting files while fewer than CONCURRENCY are uploading. Runs again whenever one
  // finishes.
  const pump = useCallback(
    function pumpQueue() {
      while (running.current < CONCURRENCY && waiting.current.length > 0) {
        const item = waiting.current.shift()!;
        running.current += 1;
        void uploadOne(item).finally(() => {
          running.current -= 1;
          pumpQueue();
        });
      }
    },
    [uploadOne],
  );

  // Fast feedback in the browser. The token route and registerDocument check all of this again.
  const addFiles = useCallback(
    async (files: File[]) => {
      let count =
        documentCount + items.filter((item) => item.state !== "failed" && !item.documentId).length;
      const accepted: UploadItem[] = [];
      const hashes = new Map<string, string>();

      for (const file of files) {
        const check = checkFile(file, count, limits);
        if (!check.ok) {
          if (check.limit) showLimitToast(check.limit);
          else toast.error(check.error);
          continue;
        }
        const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
        if (!contentMatchesKind(check.kind, head)) {
          toast.error(contentMismatchMessage(file.name, check.kind));
          continue;
        }
        // A file the user already has (or picked twice): say so instead of uploading it. The
        // server checks the stored file's hash again before reading it.
        const hash = await sha256(file);
        const existingName = hash
          ? (hashes.get(hash) ??
            (await findDuplicate({ contentHash: hash })
              .then((result) => (result.ok ? result.data?.name : undefined))
              .catch(() => undefined)))
          : undefined;
        if (existingName) {
          showLimitToast({ code: "DUPLICATE_DOCUMENT", existingName });
          continue;
        }
        if (hash) hashes.set(hash, file.name);
        accepted.push({
          key: crypto.randomUUID(),
          file,
          kind: check.kind,
          state: "waiting",
          progress: 0,
        });
        count += 1;
      }

      if (accepted.length === 0) return;
      setItems((current) => [...current, ...accepted]);
      waiting.current.push(...accepted);
      pump();
    },
    [documentCount, items, limits, pump],
  );

  // Leaving the page cancels uploads still in flight.
  useEffect(() => {
    const inFlight = controllers.current;
    return () => inFlight.forEach((controller) => controller.abort());
  }, []);

  // A registered upload hands over to its document row as soon as the list includes it.
  const handedOver = (item: UploadItem) => !!item.documentId && listedIds.has(item.documentId);
  const visible = items.filter((item) => !handedOver(item));

  // ...and is then done for good: drop it, or removing the document later would bring back an
  // "Uploading 100%" card.
  useEffect(() => {
    setItems((current) => {
      const left = current.filter((item) => !item.documentId || !listedIds.has(item.documentId));
      return left.length === current.length ? current : left;
    });
  }, [listedIds]);

  return { items: visible, addFiles, cancel: removeItem, dismiss: removeItem };
}

// The local store's upload (PUT /api/documents/upload/local): same result shape as Blob's.
async function uploadLocal(
  pathname: string,
  file: File,
  contentType: string,
  signal: AbortSignal,
): Promise<{ pathname: string }> {
  const response = await fetch(
    `/api/documents/upload/local?pathname=${encodeURIComponent(pathname)}`,
    { method: "PUT", body: file, headers: { "content-type": contentType }, signal },
  );
  if (!response.ok) throw new Error(`Local upload failed (${response.status})`);
  return { pathname };
}

// The file's SHA-256 as hex, or null where the browser can't hash (an insecure context).
async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
