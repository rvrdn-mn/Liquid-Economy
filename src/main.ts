/**
 * Phase 0 data-check page. Proves the import path end to end: sample files
 * load, and one of your own exports can be inspected. The panel shell
 * replaces this page in phase 1.
 */
import { FileImportAdapter, type ImportResult } from './data/fileAdapter';
import { decodeText } from './data/mtCsv';
import { loadSamples } from './data/samples';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fmtDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function age(asOf: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - asOf);
  if (s < 3600) return `${Math.floor(s / 60)} min old`;
  if (s < 172800) return `${Math.floor(s / 3600)} h old`;
  return `${Math.floor(s / 86400)} days old`;
}

function table(headers: [string, boolean][], rows: string[][]): HTMLTableElement {
  const el = document.createElement('table');
  const head = el.createTHead().insertRow();
  for (const [label, numeric] of headers) {
    const th = document.createElement('th');
    th.textContent = label;
    if (numeric) th.className = 'num';
    head.appendChild(th);
  }
  const body = el.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    row.forEach((cell, i) => {
      const td = tr.insertCell();
      td.textContent = cell;
      if (headers[i]?.[1]) td.className = 'num';
    });
  }
  return el;
}

function message(text: string, cls: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

const HEADERS: [string, boolean][] = [
  ['Instrument', false],
  ['TF', false],
  ['Bars', true],
  ['First bar', false],
  ['Last bar', false],
  ['Last close', true],
  ['Age', false],
  ['Source', false],
  ['Serves', false],
];

function seriesRow({ series, serves }: ImportResult): string[] {
  const first = series.bars[0]!;
  const last = series.bars[series.bars.length - 1]!;
  return [
    series.instrument,
    series.timeframe,
    String(series.bars.length),
    fmtDate(first.time),
    fmtDate(last.time),
    String(last.close),
    age(series.source.asOf),
    series.source.label,
    serves.join(' '),
  ];
}

async function showSamples(): Promise<void> {
  const out = $('samples');
  try {
    const readText = async (path: string) => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.text();
    };
    const { manifest, results } = await loadSamples(new FileImportAdapter(), readText);
    $('sample-note').textContent = `${manifest.source}. ${manifest.description}`;
    out.replaceChildren(table(HEADERS, results.map(seriesRow)));
  } catch (err) {
    out.replaceChildren(message(`Sample files could not be loaded: ${(err as Error).message}`, 'error'));
  }
}

function setUpImport(): void {
  const offset = $<HTMLSelectElement>('offset');
  for (let h = -12; h <= 14; h++) {
    const opt = document.createElement('option');
    opt.value = String(h * 60);
    opt.textContent = h === 0 ? '+0 (UTC)' : `${h > 0 ? '+' : ''}${h} h`;
    opt.selected = h === 0;
    offset.appendChild(opt);
  }
  const out = $('import-result');
  out.replaceChildren(message('No file chosen yet.', 'empty'));

  const run = async () => {
    const files = [...($<HTMLInputElement>('file').files ?? [])];
    if (files.length === 0) return;
    const adapter = new FileImportAdapter();
    const nodes: HTMLElement[] = [];
    const rows: string[][] = [];
    for (const file of files) {
      try {
        const text = decodeText(await file.arrayBuffer());
        const result = adapter.importText(file.name, text, { utcOffsetMinutes: Number(offset.value) });
        rows.push(seriesRow(result));
        const { parsed } = result;
        const detail = `${file.name}: ${parsed.format.toUpperCase()} layout, ${parsed.hasHeader ? 'with' : 'no'} header`;
        nodes.push(message(detail, 'hint'));
        if (parsed.skipped.length > 0 || parsed.duplicates > 0) {
          const firstFew = parsed.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join(', ');
          nodes.push(
            message(
              `${file.name}: ${parsed.skipped.length} rows skipped, ${parsed.duplicates} rows shared a timestamp and were combined. ${firstFew}`,
              'warn',
            ),
          );
        }
      } catch (err) {
        nodes.push(message(`${file.name}: ${(err as Error).message}`, 'error'));
      }
    }
    if (rows.length > 0) nodes.unshift(table(HEADERS, rows));
    out.replaceChildren(...nodes);
  };
  $('file').addEventListener('change', run);
  offset.addEventListener('change', run);
}

setUpImport();
void showSamples();
