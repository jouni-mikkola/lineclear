import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatView } from "../../src/chat.ts";
import type { PlanCard } from "../../src/web.ts";
import type { Attached } from "../kit/index.ts";
import { newId, useAttach } from "./chat-attach.ts";
import { get, isList, post } from "./data.ts";
import { samples } from "./sample-loader.ts";
import { CHAT_STATES, type ChatState } from "./states.ts";

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

/** The plans you asked for here: each comes back as one approval, the same item as in the Inbox. */
function usePlanCards(sample: ChatState | undefined, on: boolean, api: string) {
  const client = useQueryClient();
  const here = api === "/api/chat";
  const query = useQuery({ queryKey: ["plans"], queryFn: () => get<PlanCard[]>("/api/plans", isList), enabled: !sample && on && here });
  const plans = (here ? (sample ? samples().chat.planSamples(sample) : (query.data ?? [])) : []).filter((p) => p.by === "dispatcher");
  const [planErrors, setPlanErrors] = useState<Record<string, string | undefined>>({});
  const answerPlan = useCallback(
    async (p: PlanCard, choice: string, note?: string) => {
      if (sample || !p.item) return;
      // a new answer clears the last failure, so a second one with the same words still shows
      setPlanErrors((e) => ({ ...e, [p.task]: undefined }));
      const r = await post<{ said: string }>(`/api/inbox/${p.item.id}`, { choice, note });
      setPlanErrors((e) => ({ ...e, [p.task]: r.ok ? undefined : r.error }));
      await Promise.all([client.invalidateQueries({ queryKey: ["plans"] }), client.invalidateQueries({ queryKey: ["inbox"] })]);
    },
    [sample, client],
  );
  const undoPlan = useCallback(
    async (p: PlanCard) => {
      if (sample || !p.applied) return;
      setPlanErrors((e) => ({ ...e, [p.task]: undefined }));
      const r = await post<{ undone: number }>(`/api/inbox/${p.applied.id}/undo`, {});
      setPlanErrors((e) => ({ ...e, [p.task]: r.ok ? undefined : r.error }));
      await client.invalidateQueries({ queryKey: ["plans"] });
    },
    [sample, client],
  );
  return { plans, planErrors, answerPlan, undoPlan };
}

/** The Dispatcher's chat, live, with what you sent and attached on its way. */
export function useChat(sample: ChatState | undefined, on: boolean, api = "/api/chat") {
  const [view, setView] = useState<ChatView | undefined>(() => (sample ? samples().chat.chatSample(sample) : undefined));
  const [pending, setPending] = useState<Pending[]>(() => (sample ? samples().chat.chatSamplePending(sample) : []));
  const [attached, setAttached] = useState<Attached[]>(() => (sample ? samples().chat.chatSampleAttached(sample) : []));
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

  const { plans, planErrors, answerPlan, undoPlan } = usePlanCards(sample, on, api);
  /** Answers a card the Dispatcher asked with. */
  const choose = useCallback(
    async (question: string, choice: number): Promise<string | undefined> => {
      if (sample) return undefined;
      const r = await post(`${api}/answer`, { question, choice });
      return r.ok ? undefined : r.error;
    },
    [sample, api],
  );
  return { view, pending, attached, online, lost, attach, remove, send, retry, plans, planErrors, answerPlan, undoPlan, choose, replyTo, setReplyTo };
}
