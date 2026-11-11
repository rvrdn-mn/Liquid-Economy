/** Small line icons for the sidebar and header, drawn inline so nothing is loaded from elsewhere. */

const PATHS: Record<string, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  currencies: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.500 5.600 12 3',
  gold: 'M7 4h10l3 6-8 10L4 10zM4 10h16M9.500 10 12 20l2.500-10M9.500 10 12 4l2.500 6',
  journal: 'M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6zM6 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2M9.500 8h5M9.500 12h5',
  news: 'M4 5h13v14H5.500A1.500 1.500 0 0 1 4 17.500zM17 9h3v8.500a1.500 1.500 0 0 1-3 0M7.500 9h6M7.500 12.500h6M7.500 16h4',
  data: 'M12 3c4.400 0 8 1.300 8 3s-3.600 3-8 3-8-1.300-8-3 3.600-3 8-3M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6',
  lab: 'M9.500 3h5M10.500 3v6L5 18.500A1.700 1.700 0 0 0 6.500 21h11a1.700 1.700 0 0 0 1.500-2.500L13.500 9V3M8 14.500h8',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  help: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M9.600 9.300a2.500 2.500 0 1 1 3.400 2.400c-.700.300-1 .800-1 1.600M12 16.600v.100',
  replay: 'M4 12a8 8 0 1 0 2.600-5.900M4 4.500V9h4.500M12 8v4.500l3 1.800',
  search: 'M10.500 4a6.500 6.500 0 1 0 0 13a6.500 6.500 0 0 0 0-13M15.500 15.500 20 20',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M12 11v5.500M12 7.600v.100',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M6 9l6 6 6-6',
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name: keyof typeof PATHS | string, size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? '');
  svg.append(path);
  return svg;
}
