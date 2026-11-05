// A press shows the moment a finger or a mouse goes down. A phone sets :active only after a short wait, so the
// pressed part also gets `data-pressed` until the pointer lets go. kit.css styles both the same.

const PRESSABLE = "a[href], button:not(:disabled)";

export function showPresses(doc: Document = document) {
  let held: Element | null = null;
  const up = () => {
    held?.removeAttribute("data-pressed");
    held = null;
  };
  doc.addEventListener(
    "pointerdown",
    (e) => {
      up();
      held = (e.target as Element).closest?.(PRESSABLE) ?? null;
      held?.setAttribute("data-pressed", "");
    },
    { capture: true, passive: true },
  );
  for (const type of ["pointerup", "pointercancel", "dragstart"]) doc.addEventListener(type, up, { capture: true, passive: true });
}
