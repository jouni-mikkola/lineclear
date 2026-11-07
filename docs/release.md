# Release v0.2

## The owner's priorities

Every v0.2 step is ranked by these, in this order. Nothing ranks above the first.

1. **The core concept works first.** Add a step, an agent builds it, review, merge, next step, with nothing stalling,
   crashing or running twice.
2. **Simple.** Fewer parts, one way per job. A step that adds a part removes more than it adds, or names the core job
   only it serves.
3. **No wasted tokens.** A budget per role and per task, measured, with a step that enforces it.
4. **Fast and agile for any project**, not only Lineclear: a repo with no special setup gets the same flow, tested on a
   second small repo.
5. **The theme follows the name and logo** ([brand.md](brand.md), `ui/brand/tokens.css`, [design.md](design.md)): one
   graphite theme, green clear, amber waits for you, red only broken, in every view. The web steps check it.

Order of work: core loop reliability, then cleanup and layout that stop collisions, then token budgets, then any
project, then web.

## Agents and machines

From [plan/agents.md](plan/agents.md). v0.2 starts with these ten, all `after: none` with disjoint files:

| Rank | Step | Title |
| --- | --- | --- |
| P1 | L730 | A step is claimed by one row |
| P1 | L733 | Agents resume after a restart |
| P1 | L734 | Place by free CPU and memory |
| P1 | L735 | Each agent has a memory cap |
| P1 | L738 | One agent host per machine |
| P1 | L731 | Closing a task closes its PR |
| P2 | L732 | Worktrees by git alone |
| P2 | L737 | Idle chat panes close |
| P2 | L739 | Doctor counts leftovers |
| P3 | L736 | A token budget per session |

Then, by rank: P1 L740, L741, L742, L743, L745, L747, L750, L753, L754, L755, L757; P2 L744, L746, L748, L749;
P3 L751; P4 L752; P5 L756.
