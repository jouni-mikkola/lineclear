import { useEffect, useState } from "react";
import { get, post } from "./data.ts";
import { doctorSummary } from "./health.ts";

/** Where this device stands on alerts: not asked yet, allowed, blocked in the browser, or a try that failed. */
type Stand = "unknown" | "unsupported" | "off" | "on" | "blocked" | "busy" | "failed";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The service worker is registered for every page, so the installed app can hear a push with no page open. */
export function registerWorker() {
  if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

const bytes = (key: string) => {
  const raw = atob(
    key
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(key.length / 4) * 4, "="),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function current(): Promise<PushSubscription | null> {
  return (await navigator.serviceWorker.ready).pushManager.getSubscription();
}

/** Asks the browser, subscribes and tells the server. Throws a sentence when it cannot. */
async function allow(): Promise<void> {
  const { key } = await get<{ key: string | null }>("/api/push/key");
  if (!key) throw new Error("This server cannot send alerts.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("blocked");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) }));
  const r = await post("/api/push/subscribe", { sub: sub.toJSON(), device: navigator.platform || "device" });
  if (!r.ok) throw new Error(r.error);
}

/** One row in Settings' Secrets tab: allow alerts on this device, or see that they are on. */
export function Alerts({ sample }: { sample?: Stand }) {
  const [stand, setStand] = useState<Stand>(sample ?? "unknown");
  const [why, setWhy] = useState("");
  useEffect(() => {
    if (sample) return;
    if (!supported()) return setStand("unsupported");
    if (Notification.permission === "denied") return setStand("blocked");
    void current().then((s) => setStand(s && Notification.permission === "granted" ? "on" : "off"));
  }, [sample]);
  // nothing is drawn until the device is read, so the line does not change under the page
  if (stand === "unsupported" || stand === "unknown") return null;
  const turnOn = async () => {
    setStand("busy");
    try {
      await allow();
      setStand("on");
    } catch (e) {
      const m = (e as Error).message;
      setStand(m === "blocked" ? "blocked" : "failed");
      setWhy(m);
    }
  };
  return (
    <div className="min-w-0 rounded-lg bg-raised2 p-4 text-sm text-fg2" data-alerts={stand}>
      <h3 className="mb-1 font-medium text-fg">Alerts on this device</h3>
      {stand === "on" && "This device hears from the Inbox."}
      {stand === "blocked" && "Alerts are blocked for this site. Allow them in the browser's site settings."}
      {(stand === "off" || stand === "busy" || stand === "failed") && (
        <>
          {stand === "failed" && <span className="mr-2 text-fg2">{why || "Alerts did not turn on."}</span>}
          <button
            type="button"
            disabled={stand === "busy"}
            onClick={turnOn}
            className="rounded-sm font-medium text-fg underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:text-fg3"
          >
            {stand === "busy" ? "Turning on" : "Tell this device about new Inbox items"}
          </button>
        </>
      )}
    </div>
  );
}

/** The doctor's findings on Home: one line with a count; the problems and their fix commands show only once Details is open. */
export function DoctorLine({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm text-caution" data-doctor="">
      <p>
        {doctorSummary(lines.length)}
        <span className="text-fg3"> · </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="rounded-sm text-fg3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          Details
        </button>
      </p>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 break-words text-fg2">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
