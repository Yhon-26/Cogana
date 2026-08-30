import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useLocalOperator } from "@/context/local-operator-context";
import { useSupabaseAuth } from "@/context/supabase-auth-context";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useSync } from "@/hooks/use-sync";

const AUTO_SYNC_INTERVAL_MS = 30_000;

export function AutoSyncCoordinator() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { state, getAccessToken } = useSupabaseAuth();
  const running = useRef(false);
  const { syncNow } = useSync({
    storeId: DEFAULT_STORE_ID,
    deviceId,
    actorUserId: selectedUser?.id ?? "",
    getAccessToken,
  });

  useEffect(() => {
    if (
      state !== "authenticated" ||
      !selectedUser?.id ||
      !selectedUser.authUserId ||
      !deviceId
    ) {
      return;
    }

    let active = true;
    const runSilently = async () => {
      if (!active || running.current || AppState.currentState !== "active")
        return;
      running.current = true;
      try {
        await syncNow();
      } catch {
        console.warn(
          "[AutoSync] La sincronización automática no se pudo completar.",
        );
      } finally {
        running.current = false;
      }
    };

    const initial = setTimeout(() => void runSilently(), 750);
    const interval = setInterval(
      () => void runSilently(),
      AUTO_SYNC_INTERVAL_MS,
    );
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void runSilently();
    });

    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(interval);
      subscription.remove();
    };
  }, [deviceId, selectedUser?.authUserId, selectedUser?.id, state, syncNow]);

  return null;
}
