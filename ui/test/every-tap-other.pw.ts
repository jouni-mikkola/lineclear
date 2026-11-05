// U37: every link and button of the smaller views is tapped (ui/test/tap.ts).
import { everyTap } from "./tap.ts";

// /chat and /browsers open Home, which has its own file; /usage opens it with its sheet
everyTap(["/usage"]);
