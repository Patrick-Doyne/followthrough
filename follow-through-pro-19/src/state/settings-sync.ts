/**
 * Syncs the usability settings document to the signed-in account.
 *
 * <p>localStorage stays the first read -- it is what makes the theme apply
 * before first paint -- and the account is what makes the choices follow
 * someone to another device. The two are reconciled once per session:
 *
 * <ol>
 *   <li><b>Adopt.</b> On the first successful load of the account after
 *   sign-in, the server's document wins and replaces the local one. This is
 *   the conflict that actually happens in practice: a device with an old
 *   or empty document meets an account that has been configured elsewhere.
 *   <li><b>Push.</b> After adoption, local edits are authoritative and are
 *   written back, debounced.
 * </ol>
 *
 * <p>Adopting only once per session matters: adopting on *every* fetch
 * would let a background refetch overwrite a change made seconds earlier
 * with the stale copy the server had before the push landed.
 *
 * <p>Failures are deliberately silent. A sync that cannot reach the server
 * leaves the setting applied and stored locally, which is the whole point
 * of local-first; interrupting someone with a toast because a preference
 * did not replicate would be worse than the problem.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { userService } from "@/services/followthrough";
import { userQuery } from "@/services/queries";
import { migrateSettings, type UsabilitySettings } from "@/state/settings";

export type SyncStatus = "local" | "adopting" | "synced" | "saving";

const PUSH_DEBOUNCE_MS = 800;

export function useSettingsSync(options: {
  settings: UsabilitySettings;
  hydrated: boolean;
  isAuthenticated: boolean;
  /** Replace local settings with the account's copy. */
  adopt: (settings: UsabilitySettings) => void;
}): SyncStatus {
  const { settings, hydrated, isAuthenticated, adopt } = options;
  const queryClient = useQueryClient();

  const user = useQuery({ ...userQuery(), enabled: isAuthenticated });
  const adopted = useRef(false);
  const statusRef = useRef<SyncStatus>("local");
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Signing out must re-arm adoption, otherwise the next account to sign in
  // in this tab would push this account's settings over its own.
  useEffect(() => {
    if (!isAuthenticated) {
      adopted.current = false;
      statusRef.current = "local";
    }
  }, [isAuthenticated]);

  const save = useMutation({
    mutationFn: (document: string) =>
      userService.update({ preferences: { usabilitySettings: document } }),
    onSuccess: (next) => queryClient.setQueryData(["user"], next),
  });

  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;

  useEffect(() => {
    if (!hydrated || !isAuthenticated || adopted.current) return;
    if (!user.isSuccess) return;

    adopted.current = true;
    const stored = user.data.preferences.usabilitySettings;
    if (typeof stored !== "string" || stored.length === 0) {
      statusRef.current = "synced";
      return;
    }
    try {
      // Server data goes through the same migration as local data: it may
      // have been written by an older build of the app on another device.
      adoptRef.current(migrateSettings(JSON.parse(stored)));
      statusRef.current = "synced";
    } catch {
      statusRef.current = "local";
    }
  }, [hydrated, isAuthenticated, user.isSuccess, user.data]);

  const lastPushed = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !adopted.current) return;

    const document = JSON.stringify(settings);
    if (document === lastPushed.current) return;

    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      lastPushed.current = document;
      save.mutate(document);
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
    // `save` is a stable mutation object from TanStack Query; including it
    // would re-run this on every status change and restart the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, hydrated, isAuthenticated]);

  if (!isAuthenticated) return "local";
  if (save.isPending) return "saving";
  return statusRef.current;
}
