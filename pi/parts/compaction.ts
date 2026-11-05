// Compaction near 150 k for every model: sets each model's reserve from its window (see pi/compaction.ts).
import { applyCompaction } from "../compaction.ts";

export default function compaction(_pi: unknown): void {
  applyCompaction();
}
