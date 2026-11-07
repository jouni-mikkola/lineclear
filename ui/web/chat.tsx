import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { ChatView } from "../../src/chat.ts";
import type { PlanCard } from "../../src/web.ts";
import { MAX_FILE_BYTES, MAX_FILES } from "../../src/chat-limits.ts";
import { type Attached, sizeText } from "../kit/index.ts";
import { get, isList, post } from "./data.ts";
import { lazySamples } from "./lazy-samples.ts";
import { CHAT_STATES, type ChatState } from "./samples.ts";

// The Chat view at `/chat`: you talk to the Dispatcher, with words, pictures and files. The chat comes from the
// server's `/api/chat/events` as it changes, so the Dispatcher's answers show as it writes them. `?state=` draws a
// sample state instead.

/** What you sent that has not shown in the chat yet. */
export interface Pending {
  cid: string;
  text: string;
  files: Attached[];
  status: "sending" | "sent" | "failed";
  error?: string;
  /** The id of the message it answers. */
  reply?: string;
}

/** The sample state named by `?state=`, with the Chat view's own four. */
export function chatState(): ChatState | undefined {
  const s = new URLSearchParams(location.search).get("state") ?? "";
  return (CHAT_STATES as readonly string[]).includes(s) ? (s as ChatState) : undefined;
}

const newId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

const base64 = (f: File) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });

/** Adding and removing the files of the next message: each is uploaded at once and shows its own state. */
function useAttach(sample: ChatState | undefined, api: string, attached: Attached[], setAttached: Dispatch<SetStateAction<Attached[]>>, pending: Pending[]) {
  const attach = (files: File[]) => {
    const room = MAX_FILES - attached.filter((a) => a.state !== "failed").length;
    for (const [i, f] of files.entries()) {
      const id = newId();
      const image = /^image\/(png|jpeg|gif|webp)$/.test(f.type);
      const a: Attached = { id, name: f.name || "pasted-image.png", size: f.size, image, url: image ? URL.createObjectURL(f) : undefined, state: "uploading" };
      const fail = (error: string) => setAttached((as) => as.map((x) => (x.id === id ? { ...x, state: "failed", error } : x)));
      setAttached((as) => [...as, a]);
      if (i >= room) {
        fail(`A message can carry at most ${MAX_FILES} files.`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        fail(`${a.name} is too big: a file can be at most ${sizeText(MAX_FILE_BYTES)}.`);
        continue;
      }
      if (sample) {
        setAttached((as) => as.map((x) => (x.id === id ? { ...x, state: "ready" } : x)));
        continue;
      }
      void base64(f)
        .then((data) => post<{ id: string }>(`${api}/files`, { name: a.name, data }))
        .then((r) => (r.ok ? setAttached((as) => as.map((x) => (x.id === id ? { ...x, id: r.data.id, state: "ready" } : x))) : fail(r.error)))
        .catch(() => fail(`${a.name} could not be read.`));
    }
  };

  const remove = (id: string) =>
    setAttached((as) => {
      const gone = as.find((a) => a.id === id);
      if (gone?.url?.startsWith("blob:") && !pending.some((p) => p.files.includes(gone))) URL.revokeObjectURL(gone.url);
      return as.filter((a) => a.id !== id);
    });
  return { attach, remove };
}

/** The plans you asked for here: each comes back as one approval, the same item as in the Inbox. */
function usePlanCards(sample: ChatState | undefined, on: boolean, api: string) {
  const client = useQueryClient();
  const plansQuery = useQuery({ queryKey: ["plans"], queryFn: () => get<PlanCard[]>("/api/plans", isList), enabled: !sample && on && api === "/api/chat" });
  const plans =
    api !== "/api/chat" ? [] : (sample ? (lazySamples?.chat.planSamples(sample) ?? []) : (plansQuery.data ?? [])).filter((p) => p.by === "dispatcher");
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});
  const answerPlan = useCallback(
    async (p: PlanCard, choice: string, note?: string) => {
      if (sample || !p.item) return;
      // a new answer clears the last failure, so a second one with the same words still shows
      setPlanErrors(({ [p.task]: _, ...rest }) => rest);
      const r = await post<{ said: string }>(`/api/inbox/${p.item.id}`, { choice, note });
      setPlanErrors(({ [p.task]: _, ...rest }) => (r.ok ? rest : { ...rest, [p.task]: r.error }));
      await Promise.all([client.invalidateQueries({ queryKey: ["plans"] }), client.invalidateQueries({ queryKey: ["inbox"] })]);
    },
    [sample, client],
  );
  return { plans, planErrors, answerPlan };
}

/** The Dispatcher's chat, live, with what you sent and attached on its way. */
export function useChat(sample: ChatState | undefined, on: boolean, api = "/api/chat") {
  const [view, setView] = useState<ChatView | undefined>(() => (sample ? lazySamples?.chat.chatSample(sample) : undefined));
  const [pending, setPending] = useState<Pending[]>(() => (sample ? (lazySamples?.chat.chatSamplePending(sample) ?? []) : []));
  const [attached, setAttached] = useState<Attached[]>(() => (sample ? (lazySamples?.chat.chatSampleAttached(sample) ?? []) : []));
  const [online, setOnline] = useState(() => (sample ? sample !== "offline" : navigator.onLine));
  // the server could not be read since it last answered
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (sample) return;
    const up = () => setOnline(navigator.onLine);
    addEventListener("online", up);
    addEventListener("offline", up);
    return () => {
      removeEventListener("online", up);
      removeEventListener("offline", up);
    };
  }, [sample]);

  // one stream while the view shows; the browser opens it again when it drops
  useEffect(() => {
    if (sample || !on) return;
    const es = new EventSource(`${api}/events`);
    es.onmessage = (e) => {
      try {
        setView(JSON.parse(e.data) as ChatView);
        setLost(false);
      } catch {
        // a broken event: the next one has the whole chat again
      }
    };
    es.onerror = () => setLost(true);
    return () => es.close();
  }, [sample, on, api]);

  // what you sent leaves the pending list once the chat has it, and shows its reason when it could not go in
  useEffect(() => {
    if (!view || sample) return;
    const had = new Set(view.messages.flatMap((m) => (m.cid ? [m.cid] : [])));
    const failed = new Map(view.failed.map((f) => [f.cid, f.error]));
    setPending((ps) => {
      const next = ps.flatMap((p): Pending[] =>
        had.has(p.cid) ? [] : failed.has(p.cid) && p.status !== "failed" ? [{ ...p, status: "failed", error: failed.get(p.cid) }] : [p],
      );
      return next.length === ps.length && next.every((p, i) => p === ps[i]) ? ps : next;
    });
  }, [view, sample]);

  const { attach, remove } = useAttach(sample, api, attached, setAttached, pending);
  // a picture you sent shows from the chat once it has it: its copy in the page is let go then
  const shown = useRef(pending);
  useEffect(() => {
    const kept = new Set(pending.flatMap((p) => p.files.map((f) => f.url)));
    for (const p of shown.current) for (const f of p.files) if (f.url?.startsWith("blob:") && !kept.has(f.url)) URL.revokeObjectURL(f.url);
    shown.current = pending;
  }, [pending]);

  const go = async (p: Pending) => {
    setPending((ps) => [...ps.filter((x) => x.cid !== p.cid), { ...p, status: "sending", error: undefined }]);
    if (sample) return;
    const r = await post(api, { text: p.text, files: p.files.map((f) => f.id), cid: p.cid, ...(p.reply ? { reply: p.reply } : {}) });
    setPending((ps) => ps.map((x) => (x.cid === p.cid ? (r.ok ? { ...x, status: "sent" } : { ...x, status: "failed", error: r.error }) : x)));
  };

  /** Sends the words and the files that are ready. */
  const send = (text: string) => {
    const files = attached.filter((a) => a.state === "ready");
    if (!text.trim() && !files.length) return;
    setAttached((as) => as.filter((a) => a.state === "failed"));
    void go({ cid: newId(), text: text.trim(), files, status: "sending", ...(replyTo ? { reply: replyTo.id } : {}) });
    setReplyTo(undefined);
  };
  /** The message the next one answers. */
  const [replyTo, setReplyTo] = useState<{ id: string; text: string }>();
  /** Sends one again under the same id: Lineclear takes an id once, so a message that did go in is not sent twice. */
  const latest = useRef(pending);
  latest.current = pending;
  const retry = useCallback((cid: string) => {
    const p = latest.current.find((x) => x.cid === cid);
    if (p) void go(p);
  }, []);

  const { plans, planErrors, answerPlan } = usePlanCards(sample, on, api);
  /** Answers a card the Dispatcher asked with. */
  const choose = useCallback(
    async (question: string, choice: number): Promise<string | undefined> => {
      if (sample) return undefined;
      const r = await post(`${api}/answer`, { question, choice });
      return r.ok ? undefined : r.error;
    },
    [sample, api],
  );
  return { view, pending, attached, online, lost, attach, remove, send, retry, plans, planErrors, answerPlan, choose, replyTo, setReplyTo };
}
