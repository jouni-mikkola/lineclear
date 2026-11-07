import { useState } from "react";
import { send } from "./data.ts";

type Said = { text: string; failed?: boolean };

/** What Settings does to accounts and to Home's paused list: each moves at once and goes back, with the server's reason, when it fails. */
export function useAccountActions({
  sample,
  tell,
  refresh,
  home,
}: {
  sample: boolean;
  tell: (key: string, s: Said) => void;
  refresh: () => Promise<unknown>;
  home: () => Promise<unknown>;
}) {
  const [retired, setRetired] = useState<Record<string, boolean>>({});
  const [showPaused, setShowPaused] = useState<boolean>();
  const savePrice = async (account: string, price: string, currency: string) => {
    if (!sample) {
      const error = await send(`/api/accounts/${encodeURIComponent(account)}`, { price, currency });
      if (error) return tell(`price:${account}`, { text: error, failed: true });
      await refresh();
    }
    tell(`price:${account}`, { text: "" });
  };
  const retire = async (account: string, on: boolean) => {
    setRetired((r) => ({ ...r, [account]: on }));
    if (sample) return;
    const error = await send(`/api/accounts/${encodeURIComponent(account)}`, { retired: on });
    if (error) {
      setRetired((r) => ({ ...r, [account]: !on }));
      tell(`price:${account}`, { text: error, failed: true });
    }
    await refresh();
  };
  const togglePaused = async (on: boolean) => {
    setShowPaused(on);
    if (sample) return;
    const error = await send("/api/prefs", { showPaused: on });
    if (error) {
      setShowPaused(undefined);
      tell("paused", { text: error, failed: true });
    }
    await home();
    await refresh();
  };
  return { retired, showPaused, savePrice, retire, togglePaused };
}
