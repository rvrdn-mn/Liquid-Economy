import { describe, expect, it } from 'vitest';
import { isSafeLink, parseFeed } from '../src/data/rss';

// Feed layouts as the banks publish them; the headlines here are made up for the test.

describe('press feed reader', () => {
  it('reads RSS 2.0 items with CDATA and entities, newest first', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Press</title>
      <item><title><![CDATA[Board announces a rate decision]]></title><link><![CDATA[https://www.federalreserve.gov/newsevents/a.htm]]></link><pubDate>Mon, 09 Nov 2026 21:00:00 GMT</pubDate><description>Long text that is not copied</description></item>
      <item><title>Minutes &amp; projections released</title><link>https://www.federalreserve.gov/newsevents/b.htm</link><pubDate>Tue, 10 Nov 2026 19:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(parseFeed(xml, 'federalreserve.gov')).toEqual([
      { title: 'Minutes & projections released', link: 'https://www.federalreserve.gov/newsevents/b.htm', time: Date.UTC(2026, 10, 10, 19) / 1000 },
      { title: 'Board announces a rate decision', link: 'https://www.federalreserve.gov/newsevents/a.htm', time: Date.UTC(2026, 10, 9, 21) / 1000 },
    ]);
  });

  it('reads RDF items dated with dc:date', () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>Bank</title></channel>
      <item rdf:about="https://www.bankofcanada.ca/2026/11/x/"><title>Policy rate announcement</title><link>https://www.bankofcanada.ca/2026/11/x/</link><dc:date>2026-11-04T09:45:00-05:00</dc:date></item>
    </rdf:RDF>`;
    expect(parseFeed(xml, 'bankofcanada.ca')).toEqual([{ title: 'Policy rate announcement', link: 'https://www.bankofcanada.ca/2026/11/x/', time: Date.UTC(2026, 10, 4, 14, 45) / 1000 }]);
  });

  it('reads Atom entries, whose link is an attribute', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Statement</title><link rel="alternate" href="https://www.rba.gov.au/media/s.html"/><updated>2026-11-03T03:30:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, 'rba.gov.au')[0]).toEqual({ title: 'Statement', link: 'https://www.rba.gov.au/media/s.html', time: Date.UTC(2026, 10, 3, 3, 30) / 1000 });
  });

  it('drops items that link anywhere but the bank, or have no title', () => {
    const xml = `<rss><channel>
      <item><title>Off-site</title><link>https://evil.example/federalreserve.gov</link></item>
      <item><title>Script</title><link>javascript:alert(1)</link></item>
      <item><title>Plain http</title><link>http://www.federalreserve.gov/x</link></item>
      <item><title></title><link>https://www.federalreserve.gov/y</link></item>
      <item><title>Kept, no date</title><link>https://www.federalreserve.gov/z</link></item>
    </channel></rss>`;
    expect(parseFeed(xml, 'federalreserve.gov')).toEqual([{ title: 'Kept, no date', link: 'https://www.federalreserve.gov/z', time: null }]);
  });

  it('strips markup from a title so it can only ever be shown as text', () => {
    const xml = `<rss><channel><item><title>Rates &lt;b&gt;held&lt;/b&gt; <i>today</i></title><link>https://www.snb.ch/a</link></item></channel></rss>`;
    expect(parseFeed(xml, 'snb.ch')[0]!.title).toBe('Rates <b>held</b> today');
  });

  it('checks links by host, including subdomains', () => {
    expect(isSafeLink('https://www.ecb.europa.eu//press/x', 'ecb.europa.eu')).toBe(true);
    expect(isSafeLink('https://ecb.europa.eu/x', 'ecb.europa.eu')).toBe(true);
    expect(isSafeLink('https://notecb.europa.eu.example/x', 'ecb.europa.eu')).toBe(false);
    expect(isSafeLink('https://fakeecb.europa.eu/x', 'ecb.europa.eu')).toBe(false);
    expect(isSafeLink('not a url', 'ecb.europa.eu')).toBe(false);
  });
});
