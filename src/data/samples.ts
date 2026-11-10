/**
 * Loads the sample set that ships with the project, so the demo works
 * with no feed at all. The reader is injected: the browser passes a
 * fetch-based reader, tests pass a file-system reader.
 */
import type { FileImportAdapter, ImportResult } from './fileAdapter';
import type { InstrumentId, Timeframe } from './types';

export interface SampleFile {
  path: string;
  instrument: InstrumentId;
  timeframe: Timeframe;
}

export interface SampleManifest {
  /** What the files are and where they came from, shown in the app. */
  description: string;
  source: string;
  sourceUrl: string;
  licenceNote: string;
  /** ISO date-time the files were generated. */
  retrievedAt: string;
  /** True when each bar is one daily observation (open=high=low=close). */
  closeOnly: boolean;
  utcOffsetMinutes: number;
  files: SampleFile[];
}

export type TextReader = (path: string) => Promise<string>;

export async function loadSamples(
  adapter: FileImportAdapter,
  readText: TextReader,
  manifestPath = 'samples/manifest.json',
): Promise<{ manifest: SampleManifest; results: ImportResult[] }> {
  const manifest = JSON.parse(await readText(manifestPath)) as SampleManifest;
  const base = manifestPath.replace(/[^/]*$/, '');
  const retrievedAt = Math.floor(Date.parse(manifest.retrievedAt) / 1000);
  const results: ImportResult[] = [];
  for (const file of manifest.files) {
    const text = await readText(base + file.path);
    results.push(
      adapter.importText(file.path, text, {
        instrument: file.instrument,
        timeframe: file.timeframe,
        utcOffsetMinutes: manifest.utcOffsetMinutes,
        now: () => retrievedAt,
        source: {
          label: `Sample: ${manifest.source}`,
          note: manifest.description,
          closeOnly: manifest.closeOnly,
          freshness: 'file',
        },
      }),
    );
  }
  return { manifest, results };
}
