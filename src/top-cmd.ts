import { agentStatus, statusLines } from "./agent-status.ts";
import { homeData } from "./home-data.ts";

/** `lineclear top`: the rows Home's task table shows, as text. */
export function topMain(out: (l: string) => void, data = homeData()): number {
  for (const l of statusLines(agentStatus(data.projects, data.loose, data.host, data.at))) out(l);
  return 0;
}
