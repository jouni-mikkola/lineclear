import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Answer,
  BackLink,
  type Browser,
  BrowserCard,
  BrowserGrid,
  Button,
  hostOf,
  LivePicture,
  PageTitle,
  Part,
  splitSessions,
  whereOf,
} from "../kit/index.ts";
import { samplePictureOf } from "./browser-samples.ts";
import { drive, type Load } from "./data.ts";

// The agents' browsers at `/browsers`: each open playwright-cli session as a card with a live picture. One click
// opens one at `/browsers/<session>` to watch it, and one more takes it over.

const SHOWN = 24;
const pictureOf = (b: Browser, sample: boolean, thumb = false) =>
  sample ? samplePictureOf(b) : `/api/browsers/${encodeURIComponent(b.session)}/picture${thumb ? "?size=thumb" : ""}`;
const browserPath = (session: string) => `/browsers/${encodeURIComponent(session)}`;

/** One group per project, the one with a browser that waits first and the sessions of no project last. */
const byProject = (list: Browser[]) => [...Map.groupBy(list, (b) => b.project ?? "")].sort((a, b) => Number(!a[0]) - Number(!b[0]));

const Label = ({ children }: { children: React.ReactNode }) => <h2 className="mb-3 text-sm font-medium text-fg3">{children}</h2>;

export function Browsers({ load, session, sample }: { load: Load<Browser[]>; session?: string; sample: boolean }) {
  if (load.status === "error") return <Part main state="error" label="The browsers" empty={{ text: "" }} error={load.error} onRetry={load.retry} />;
  if (session !== undefined) return <Watch load={load} session={session} sample={sample} />;
  const all = load.status === "ok" ? load.data : [];
  const state = load.status === "loading" ? "loading" : all.length ? "filled" : "empty";
  const { tasks, other } = splitSessions(all);
  const card = (b: Browser) => <BrowserCard b={b} picture={pictureOf(b, sample, true)} href={browserPath(b.session)} />;
  const grid = (list: Browser[]) => (
    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((b) => (
        <li key={b.session} className="min-w-0">
          {card(b)}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageTitle>Browsers</PageTitle>
      <section>
        <Label>Task browsers</Label>
        <Part state={state} label="The browsers" empty={{ text: "No browser is open." }} rows={2}>
          {byProject(tasks.slice(0, SHOWN)).map(([project, list]) => (
            <div key={project} className={project ? "mt-5 border-l-2 border-line pl-3 first:mt-0" : "first:mt-0"} data-track={project || undefined}>
              {project && <h3 className="mb-2 text-sm font-medium text-fg2">{project}</h3>}
              <BrowserGrid items={list} card={card} />
            </div>
          ))}
          {!tasks.length && <p className="text-sm text-fg3">No task has a browser open.</p>}
          {tasks.length > SHOWN && (
            <Collapsible.Root className="mt-3">
              <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">{tasks.length - SHOWN} more open</Collapsible.Trigger>
              <Collapsible.Panel>{grid(tasks.slice(SHOWN))}</Collapsible.Panel>
            </Collapsible.Root>
          )}
          {other.length > 0 && (
            <Collapsible.Root className="mt-6" data-other-sessions>
              <Collapsible.Trigger className="text-sm text-fg3 hover:text-fg">Other sessions ({other.length})</Collapsible.Trigger>
              <Collapsible.Panel>{grid(other)}</Collapsible.Panel>
            </Collapsible.Root>
          )}
        </Part>
      </section>
    </>
  );
}

const KEY_LABEL: Record<string, string> = { Enter: "Enter", Tab: "Tab", Backspace: "Delete", Escape: "Esc" };

/** One browser, live: watch it, or take it over and click and type in it. */
function Watch({ load, session, sample }: { load: Load<Browser[]>; session: string; sample: boolean }) {
  const client = useQueryClient();
  const b = load.status === "ok" ? load.data.find((x) => x.session === session) : undefined;
  const [mine, setMine] = useState<boolean | undefined>(undefined);
  const [said, setSaid] = useState<{ text: string; failed?: boolean } | undefined>();
  const [text, setText] = useState("");
  const taken = mine ?? b?.taken ?? false;

  const back = <BackLink href="/browsers">All browsers</BackLink>;
  if (load.status === "loading") return <Part main state="loading" label="The browser" empty={{ text: "" }} rows={3} />;
  if (!b) {
    return (
      <>
        {back}
        <div className="mt-6">
          <Part main state="empty" label="The browser" empty={{ text: `The browser ${session} is not open.` }} />
        </div>
      </>
    );
  }

  const send = async (body: { do: string; [k: string]: unknown }, done: string) => {
    setSaid(undefined);
    const error = sample ? undefined : await drive(session, "input", body);
    setSaid(error ? { text: error, failed: true } : { text: done });
  };
  const take = async (on: boolean) => {
    setSaid(undefined);
    const error = sample ? undefined : await drive(session, "take", { take: on });
    if (error) return setSaid({ text: error, failed: true });
    setMine(on);
    await client.invalidateQueries({ queryKey: ["browsers"] });
  };
  const where = whereOf(b) || b.session;

  return (
    <div data-watch={b.session}>
      {back}
      <div className="mt-6">
        <Answer tone={b.waits ? "caution" : "clear"} text={b.title} />
      </div>
      {b.waits && <p className="mt-2 break-words text-fg2 md:text-lg">{b.waits.question}</p>}
      <p className="mt-2 truncate text-sm text-fg3" title={b.page?.url ?? where}>
        {where}
        {b.page ? ` · ${b.page.url}` : ""}
      </p>
      {b.machine && (
        <p className="mt-6 text-sm text-fg2" data-remote={b.machine}>
          This browser runs on {b.machine}. Watch it and take it over on that machine's Lineclear.
        </p>
      )}
      <div className={`mt-6 flex flex-wrap items-center gap-3 ${b.machine ? "hidden" : ""}`}>
        {taken ? (
          <Button quiet onClick={() => void take(false)} data-testid="give-back">
            Give it back
          </Button>
        ) : (
          <Button onClick={() => void take(true)} data-testid="take-over">
            Take over
          </Button>
        )}
      </div>
      <div className={`mt-4 rounded-lg border p-1.5 ${taken ? "border-caution/50" : "border-line"} ${b.machine ? "hidden" : ""}`}>
        <LivePicture
          src={pictureOf(b, sample)}
          every={1000}
          alt={`What ${b.title} shows now`}
          fit="whole"
          host={b.page && hostOf(b.page.url)}
          onPoint={taken ? (x, y) => void send({ do: "click", x, y }, `Clicked at ${Math.round(x)}, ${Math.round(y)}.`) : undefined}
        />
      </div>
      {taken && (
        <div className="mt-3 space-y-3" data-controls>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text) return;
              void send({ do: "type", text }, "Typed it.");
              setText("");
            }}
          >
            <Input
              value={text}
              onValueChange={setText}
              placeholder="Type into the page"
              aria-label="Type into the page"
              autoComplete="off"
              className="min-h-9 min-w-0 flex-1 basis-60 rounded-sm border border-line bg-base px-3 text-sm text-fg placeholder:text-fg3"
            />
            <Button submit>Type</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {Object.entries(KEY_LABEL).map(([key, label]) => (
              <Button key={key} quiet onClick={() => void send({ do: "key", key }, `Pressed ${label}.`)}>
                {label}
              </Button>
            ))}
            <Button quiet onClick={() => void send({ do: "scroll", dy: -400 }, "Scrolled up.")}>
              Scroll up
            </Button>
            <Button quiet onClick={() => void send({ do: "scroll", dy: 400 }, "Scrolled down.")}>
              Scroll down
            </Button>
          </div>
        </div>
      )}
      {said && (
        <p className={`mt-3 break-words text-sm ${said.failed ? "text-fg" : "text-fg2"}`} role="status">
          {said.text}
        </p>
      )}
    </div>
  );
}
