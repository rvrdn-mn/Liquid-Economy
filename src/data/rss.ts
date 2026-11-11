/**
 * Reads headlines out of a press feed (RSS 2.0, RDF/RSS 1.0 or Atom).
 * Pure. Only the title, link and date are taken; no article text.
 */

export interface FeedItem {
  title: string;
  link: string;
  /** UTC epoch seconds; null when the feed gives no readable date. */
  time: number | null;
}

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    if (m && m[1]!.trim() !== '') return m[1]!;
  }
  return null;
}

/**
 * Items of a feed, newest first. An item is kept only if it has a title
 * and an https link whose host is `host` or a subdomain of it, so a feed
 * can never plant a link to somewhere else.
 */
export function parseFeed(xml: string, host: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const block = m[2]!;
    const title = decode(tag(block, ['title']) ?? '');
    let link = decode(tag(block, ['link']) ?? '');
    if (link === '') link = /<link\b[^>]*\bhref="([^"]+)"/i.exec(block)?.[1] ?? '';
    const rawDate = tag(block, ['pubDate', 'dc:date', 'updated', 'published']);
    const ms = rawDate ? Date.parse(decode(rawDate)) : NaN;
    if (title === '' || !isSafeLink(link, host)) continue;
    items.push({ title, link, time: Number.isFinite(ms) ? Math.floor(ms / 1000) : null });
  }
  return items.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

/** True for an https address on `host` or one of its subdomains. */
export function isSafeLink(link: string, host: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && (url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
