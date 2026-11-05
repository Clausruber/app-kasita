import { Fragment } from "react";

// http(s) links in message text; trailing punctuation ("…aquí: https://x.com/a.") stays outside the link.
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;

/** Message text with its URLs as links (opened in a new tab). Everything else stays plain text. */
export function LinkedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(<Fragment key={`t${i}`}>{text.slice(last, i)}</Fragment>);
    parts.push(
      <a key={`a${i}`} href={m[0]} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2 hover:opacity-80">
        {m[0]}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
