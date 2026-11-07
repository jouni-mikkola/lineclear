// What the web chat takes in one message, shared by the server and the page.

/** The most one file may weigh. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The most files one message may carry. */
export const MAX_FILES = 10;
/** The most characters one message may have. */
export const MAX_TEXT = 20_000;

export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
/** Files the Dispatcher can read as text. */
export const TEXT_EXT = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".log",
  ".xml",
  ".html",
  ".css",
  ".diff",
  ".patch",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".php",
  ".sh",
  ".sql",
]);
/** What a refused file is told, in one line. */
export const ACCEPTED = "Images (PNG, JPEG, GIF, WebP), PDF and text files";

/** What a file picker offers: the same kinds the server takes. */
export const ACCEPT = [...Object.keys(IMAGE_TYPES), ".pdf", ...TEXT_EXT].join(",");

/** 1.2 MB, 340 KB, 12 bytes. */
export function sizeText(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}
