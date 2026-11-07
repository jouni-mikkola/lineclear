import type { ChatView } from "../../src/chat.ts";
import type { PlanCard } from "../../src/web.ts";
import { Handoff, InboxCard, type ThreadItem } from "../kit/index.ts";
import { Quote, ReplyButton } from "../kit/chat-reply.tsx";
import type { Pending, useChat } from "./chat.tsx";

// The rows of the chat thread: the messages, the plans you asked for placed among them, and what you sent that has not come back.

const PLAN_SAID: Record<PlanCard["state"], string> = {
  planning: "The planner writes the steps again, with your note.",
  approve: "",
  approved: "Approved. The steps are in the roadmap, and each starts when the steps before it are merged.",
  rejected: "Rejected. The roadmap stays as it was.",
  closed: "Closed. The roadmap stays as it was.",
};

/** A plan you asked for, in the chat: to approve while it waits, then what came of it, with its live link. */
function PlanInChat({ plan, error, onAnswer }: { plan: PlanCard; error?: string; onAnswer: (choice: string, note?: string) => void }) {
  const steps = plan.steps.length ? `${plan.steps.length === 1 ? "1 step" : `${plan.steps.length} steps`}: ${plan.steps.join(", ")}. ` : "";
  return (
    <div className="grid gap-2" data-plan={plan.task} data-plan-state={plan.state}>
      {plan.item ? (
        <InboxCard item={plan.item} onAnswer={onAnswer} error={error} />
      ) : (
        <p className="text-fg2">
          {steps}
          {PLAN_SAID[plan.state]}
        </p>
      )}
      <Handoff project={plan.project} href={plan.live}>
        See {plan.goal.length > 48 ? "the steps" : `"${plan.goal}"`} live in <span className="font-medium text-fg">{plan.project}</span>
      </Handoff>
    </div>
  );
}

/** Where the plan you asked for goes: after the last message written before it was asked. */
function planPlace(messages: ChatView["messages"], since: number) {
  let at = messages.length;
  while (at > 0 && (messages[at - 1]?.at ?? -Infinity) > since) at--;
  return at;
}

/** The thread's rows: the chat, then what you sent that it does not have yet. */
export function rows(
  view: ChatView,
  pending: Pending[],
  retry: (cid: string) => void,
  chat: Pick<ReturnType<typeof useChat>, "plans" | "planErrors" | "answerPlan" | "choose" | "setReplyTo">,
  rich: boolean,
): ThreadItem[] {
  const out: ThreadItem[] = view.messages.map((m) => ({
    key: m.id,
    who: m.who,
    text: m.text,
    file: m.file,
    ...(m.waiting ? { status: "waiting" as const } : {}),
    ...(m.question ? { question: m.question, onChoose: (i: number) => chat.choose(m.question!.id, i) } : {}),
    ...(m.reply ? { above: <Quote text={m.reply.text} /> } : {}),
    ...(rich ? { below: <ReplyButton onReply={() => chat.setReplyTo({ id: m.id, text: m.text ?? m.file?.name ?? "" })} /> } : {}),
  }));
  // from the end, so each place still counts the messages only; of two at one place the older goes first
  const placed = chat.plans
    .filter((p) => p.state !== "planning" || p.answer)
    .map((p, order) => ({ p, order, at: planPlace(view.messages, Date.parse(p.since)) }))
    .sort((a, b) => b.at - a.at || a.order - b.order);
  for (const { p, at } of placed) {
    const card = <PlanInChat plan={p} error={chat.planErrors[p.task]} onAnswer={(c, note) => void chat.answerPlan(p, c, note)} />;
    out.splice(at, 0, { key: `plan-${p.task}`, who: "dispatcher", card });
  }
  for (const p of pending) {
    const mine: ThreadItem[] = [
      ...p.files.map((f): ThreadItem => ({ key: `${p.cid}-${f.id}`, who: "you", file: { name: f.name, size: f.size, image: f.image, url: f.url } })),
      ...(p.text ? [{ key: `${p.cid}-text`, who: "you" as const, text: p.text }] : []),
    ];
    const last = mine.at(-1);
    if (last && p.status !== "sent") Object.assign(last, { status: p.status, error: p.error, onRetry: p.status === "failed" ? () => retry(p.cid) : undefined });
    out.push(...mine);
  }
  return out;
}
