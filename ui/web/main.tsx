import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import "../kit/kit.css";
import "./token.ts";
import { showPresses } from "../kit/press.ts";
import { registerWorker } from "./alerts.tsx";
import { App } from "./app.tsx";
import { isAppPath } from "./routes.ts";
import { queryClient } from "./data.ts";

// Home at `/`, a project's roadmap at `/<project>/roadmap`, the agents' browsers at
// `/browsers`, the Dispatcher's chat at `/chat`, Settings at `/settings`.
const path = location.pathname.replace(/\/+$/, "") || "/";
showPresses();
registerWorker();
// The first paint waits for the fonts (two seconds at most), so no text changes width when they arrive and the page
// does not move.
const fonts = Promise.race([
  Promise.all(["1em Geist", "1em 'Geist Mono'"].map((f) => document.fonts.load(f))),
  new Promise((done) => setTimeout(done, 2000)),
]).catch(() => undefined);
const root = () => createRoot(document.getElementById("root") as HTMLElement);
if (isAppPath(path)) {
  void fonts.then(() =>
    root().render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    ),
  );
} else location.replace(`/${location.search}`);
