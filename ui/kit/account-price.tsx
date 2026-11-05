import { Input } from "@base-ui/react/input";
import { useState } from "react";

const inputClass = "min-h-9 w-full min-w-0 rounded-sm border border-line bg-base px-3 font-mono text-sm text-fg placeholder:text-fg3";

/** An account with what its subscription costs a month, when the owner set it. */
export interface AccountSetting {
  account: string;
  kind: "subscription" | "free" | "extra" | "key";
  price?: number;
  currency?: string;
  /** The owner stopped using it: usage and spend leave it out. */
  retired?: boolean;
}

/**
 * One compact row per account: its name, monthly price and currency, saved when a field is left or Enter is pressed,
 * and a Retired box. An empty price means not set: Lineclear never guesses a price.
 */
export function AccountPrice({
  a,
  onSave,
  onRetire,
  said,
}: {
  a: AccountSetting;
  onSave: (price: string, currency: string) => void;
  onRetire: (retired: boolean) => void;
  said?: { text: string; failed?: boolean };
}) {
  const [price, setPrice] = useState<string | undefined>();
  const [currency, setCurrency] = useState<string | undefined>();
  const id = `price-${a.account}`;
  const paysPerUse = a.kind === "key" || a.kind === "extra";
  const shownPrice = price ?? (a.price !== undefined ? String(a.price) : "");
  const shownCurrency = currency ?? a.currency ?? "USD";
  // only a changed field is saved
  const commit = () => {
    if (price === undefined && currency === undefined) return;
    if (shownPrice.trim() !== (a.price !== undefined ? String(a.price) : "") || shownCurrency !== (a.currency ?? "USD"))
      onSave(shownPrice.trim(), shownCurrency);
    setPrice(undefined);
    setCurrency(undefined);
  };
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && (e.currentTarget as HTMLElement).blur();
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${a.retired ? "opacity-60" : ""}`} data-account={a.account}>
      <label className="min-w-0 flex-1 basis-32 truncate text-sm text-fg" htmlFor={id} title={a.account}>
        {a.account}
      </label>
      {paysPerUse || a.kind === "free" ? (
        <span className="text-sm text-fg2">{a.kind === "free" ? "Free" : "Pay as you go"}</span>
      ) : (
        <span className="flex items-center gap-2">
          <Input
            id={id}
            value={shownPrice}
            onValueChange={setPrice}
            onBlur={commit}
            onKeyDown={enter}
            placeholder="not set"
            inputMode="decimal"
            aria-label={`Price of ${a.account} a month`}
            className={`${inputClass} w-24`}
            autoComplete="off"
          />
          <Input
            value={shownCurrency}
            onValueChange={setCurrency}
            onBlur={commit}
            onKeyDown={enter}
            aria-label={`Currency of ${a.account}`}
            maxLength={3}
            className={`${inputClass} w-16 uppercase`}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-sm text-fg3">/ month</span>
        </span>
      )}
      <label className="flex items-center gap-1.5 text-sm text-fg2 max-sm:min-h-11">
        <input type="checkbox" checked={a.retired === true} onChange={(e) => onRetire(e.target.checked)} data-testid={`retire-${a.account}`} />
        Retired
      </label>
      {said && (
        <p className={`basis-full break-words text-sm ${said.failed ? "text-caution" : "text-fg2"}`} role="status">
          {said.text}
        </p>
      )}
    </div>
  );
}
