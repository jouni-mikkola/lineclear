import { ROLE_ICONS, type RoleName } from "../brand/roles.ts";

export type { RoleName };

/** A role's small icon, in the colour of the text around it. Named for screen readers unless `hidden`. */
export function RoleIcon({ role, size = 16, hidden, className = "" }: { role: RoleName; size?: number; hidden?: boolean; className?: string }) {
  const { label, shapes } = ROLE_ICONS[role];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`shrink-0 ${className}`}
      data-role-icon={role}
      {...(hidden ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {shapes.map((s, i) =>
          "d" in s ? (
            <path key={i} d={s.d} />
          ) : (
            <circle key={i} cx={s.circle[0]} cy={s.circle[1]} r={s.circle[2]} {...("fill" in s && s.fill ? { fill: "currentColor", stroke: "none" } : {})} />
          ),
        )}
      </g>
    </svg>
  );
}

const DISPATCHER: RoleName = "dispatcher";

/** The Dispatcher's icon, the one the chat and the input use. */
export const DispatcherIcon = ({ size, className }: { size: number; className?: string }) => (
  <RoleIcon role={DISPATCHER} size={size} hidden className={className} />
);

/** The worker's icon, the one a task's chat uses for its agent. */
// biome-ignore lint/a11y/useValidAriaRole: `role` names a Lineclear role, not an ARIA one
export const WorkerIcon = ({ size, className }: { size: number; className?: string }) => <RoleIcon role="worker" size={size} hidden className={className} />;
