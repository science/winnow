// Balanced-brace extraction of JSON blobs embedded in YouTube pages.
// A non-greedy regex terminated by `};</script>` truncates whenever that
// byte sequence occurs inside a JSON string, so we scan brace depth
// instead, honoring string literals and escapes.

/**
 * Return the JSON object text that follows `anchor` in `html`, or null
 * when the anchor is missing, no `{` follows it, or braces never balance.
 */
export function extractJsonBlob(html: string, anchor: RegExp): string | null {
  const m = anchor.exec(html);
  if (!m) return null;
  const start = html.indexOf("{", m.index + m[0].length);
  if (start === -1) return null;
  // Anything but whitespace between anchor and `{` means the anchor wasn't
  // assigned an object literal (e.g. `= null;`).
  if (html.slice(m.index + m[0].length, start).trim() !== "") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}
