import { Switch } from "@base-ui/react/switch";
import { useState } from "react";

/**
 * Running or Paused: the one switch of a project. Running, the rules start its next steps; Paused, none. It moves at
 * once and goes back, with the server's reason, when the change fails.
 */
export function RunSwitch({ name, paused, onChange }: { name: string; paused: boolean; onChange: (paused: boolean) => Promise<string | undefined> }) {
  const [shown, setShown] = useState<boolean>();
  const [error, setError] = useState<string>();
  const on = !(shown ?? paused);
  const change = async (running: boolean) => {
    setShown(!running);
    setError(undefined);
    const why = await onChange(!running);
    if (why) setError(why);
    setShown(undefined);
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-run={on ? "running" : "paused"}>
      <Switch.Root
        checked={on}
        onCheckedChange={(v) => void change(v)}
        aria-label={`${name}: ${on ? "Running, the rules start its next steps" : "Paused, the rules start none of its steps"}`}
        className="group inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full hover:brightness-110 active:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg max-sm:min-h-11 max-sm:min-w-11"
      >
        {/* the track sits in a phone-sized hit area: the switch stays small, the finger target does not */}
        <span className="inline-flex h-5 w-9 items-center rounded-full bg-raised2 px-0.5 transition-colors duration-200 group-data-[checked]:bg-clear/80 motion-reduce:transition-none">
          <Switch.Thumb className="block size-4 translate-x-0 rounded-full bg-fg transition-transform duration-200 data-[checked]:translate-x-4 motion-reduce:transition-none" />
        </span>
      </Switch.Root>
      <span className={`text-xs ${on ? "text-fg2" : "text-fg3"}`}>{on ? "Running" : "Paused"}</span>
      {error && (
        <span role="alert" className="min-w-0 text-xs text-stop [overflow-wrap:anywhere]">
          {error}
        </span>
      )}
    </span>
  );
}
