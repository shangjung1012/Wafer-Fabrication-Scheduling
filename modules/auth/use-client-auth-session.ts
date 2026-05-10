"use client";

import { useSyncExternalStore } from "react";

import {
  CLIENT_AUTH_SESSION_EVENT,
  loadClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";

type ClientAuthSessionSnapshot = ClientAuthSession | null | undefined;

let cachedSnapshotKey = "";
let cachedSnapshot: ClientAuthSession | null = null;

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CLIENT_AUTH_SESSION_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CLIENT_AUTH_SESSION_EVENT, onStoreChange);
  };
}

function getClientSnapshot(): ClientAuthSessionSnapshot {
  const nextSnapshot = loadClientAuthSession();
  const nextSnapshotKey = nextSnapshot ? JSON.stringify(nextSnapshot) : "null";
  if (nextSnapshotKey === cachedSnapshotKey) return cachedSnapshot;

  cachedSnapshotKey = nextSnapshotKey;
  cachedSnapshot = nextSnapshot;
  return cachedSnapshot;
}

function getServerSnapshot(): ClientAuthSessionSnapshot {
  return undefined;
}

export function useClientAuthSession(): ClientAuthSessionSnapshot {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
