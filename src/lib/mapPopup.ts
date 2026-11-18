import type { MapPopupData } from '../types/maps';

const SVG_NS = 'http://www.w3.org/2000/svg';

type IconName = 'person' | 'pin' | 'phone' | 'mail' | 'ext';

const ICON_PATHS: Record<IconName, { size: number; strokeWidth: string; elements: Array<[string, Record<string, string>]> }> = {
  person: {
    size: 15,
    strokeWidth: '2',
    elements: [
      ['path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '12', cy: '7', r: '4' }],
    ],
  },
  pin: {
    size: 15,
    strokeWidth: '2',
    elements: [
      ['path', { d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }],
      ['circle', { cx: '12', cy: '10', r: '3' }],
    ],
  },
  phone: {
    size: 15,
    strokeWidth: '2',
    elements: [
      [
        'path',
        {
          d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
        },
      ],
    ],
  },
  mail: {
    size: 15,
    strokeWidth: '2',
    elements: [
      ['path', { d: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z' }],
      ['polyline', { points: '22,6 12,13 2,6' }],
    ],
  },
  ext: {
    size: 13,
    strokeWidth: '2.2',
    elements: [
      ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
      ['polyline', { points: '15 3 21 3 21 9' }],
      ['line', { x1: '10', y1: '14', x2: '21', y2: '3' }],
    ],
  },
};

function createIcon(name: IconName): SVGSVGElement {
  const spec = ICON_PATHS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(spec.size));
  svg.setAttribute('height', String(spec.size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', spec.strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  for (const [tag, attrs] of spec.elements) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  return svg;
}

export function formatCategorySlug(slug?: string): string {
  if (!slug) return '';
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, '');
  } catch {
    return urlStr.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
  }
}

function createIconRow(icon: IconName, content: Node, extraClass?: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = extraClass
    ? `flex items-start gap-2 ${extraClass}`
    : 'flex items-start gap-2';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'text-primary shrink-0 mt-0.5 inline-flex items-center';
  iconWrap.appendChild(createIcon(icon));

  row.append(iconWrap, content);
  return row;
}

function createCtaButton(url: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'btn btn-sm btn-secondary hover:btn-primary w-full gap-1.5 font-sans font-semibold no-underline';

  const span = document.createElement('span');
  span.textContent = label;
  link.append(span, createIcon('ext'));
  return link;
}

export interface CreatePopupOptions {
  color?: string;
  categoryLabel?: string;
}

/**
 * Builds an accessible `.neu-popup-card` DOM element from structured `MapPopupData`.
 * Designed to be passed directly to `mapboxgl.Popup.setDOMContent()`.
 */
export function createPopupElement(popup: MapPopupData, options: CreatePopupOptions = {}): HTMLElement {
  const title = (popup.title ?? '').trim();
  const categoryLabel = (popup.category ?? options.categoryLabel ?? '').trim();
  const accentColor = options.color || '#d7935b';

  const card = document.createElement('div');
  card.className = 'neu-popup-card flex flex-col min-w-60';
  card.setAttribute('role', 'dialog');
  if (title) {
    card.setAttribute('aria-label', title);
  }

  const accent = document.createElement('div');
  accent.className = 'neu-popup-accent h-1.5 w-full bg-primary';
  accent.style.background = accentColor;
  card.appendChild(accent);

  const inner = document.createElement('div');
  inner.className = 'neu-popup-inner p-4 flex flex-col gap-2.5';

  if (categoryLabel) {
    const badge = document.createElement('span');
    badge.className = 'neu-popup-badge badge badge-sm badge-outline self-start font-bold uppercase tracking-wider mr-8';
    badge.textContent = categoryLabel;
    inner.appendChild(badge);
  }

  if (title) {
    const heading = document.createElement('h4');
    heading.className = 'neu-popup-title m-0 pr-8 pb-2 border-b-2 border-primary font-display text-2xl font-bold leading-tight text-neutral';
    heading.textContent = title;
    inner.appendChild(heading);
  }

  const rows = document.createElement('div');
  rows.className = 'flex flex-col gap-2 text-sm leading-snug text-secondary';

  if (popup.lead) {
    const strong = document.createElement('strong');
    strong.textContent = popup.lead;
    rows.appendChild(createIconRow('person', strong, 'text-neutral text-sm'));
  }

  if (popup.address) {
    const span = document.createElement('span');
    span.textContent = popup.address;
    rows.appendChild(createIconRow('pin', span, 'text-secondary'));
  }

  if (popup.phone) {
    const digits = popup.phone.replace(/\D/g, '');
    const telLink = document.createElement('a');
    telLink.href = `tel:${digits}`;
    telLink.className = 'link link-secondary hover:link-primary font-semibold break-words';
    telLink.textContent = popup.phone;
    rows.appendChild(createIconRow('phone', telLink));
  }

  if (popup.email) {
    const mailLink = document.createElement('a');
    mailLink.href = `mailto:${popup.email}`;
    mailLink.className = 'link link-secondary hover:link-primary font-semibold break-words';
    mailLink.textContent = popup.email;
    rows.appendChild(createIconRow('mail', mailLink));
  }

  if (popup.details && popup.details.length > 0) {
    for (const detail of popup.details) {
      const textEl = document.createElement('div');
      textEl.className = 'text-secondary text-sm leading-relaxed';
      textEl.textContent = detail;
      rows.appendChild(textEl);
    }
  }

  if (rows.childElementCount > 0) {
    inner.appendChild(rows);
  }

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap gap-2 mt-1 pt-2 border-t border-base-300';

  if (popup.website) {
    actions.appendChild(createCtaButton(popup.website, `Visit Website (${cleanHostname(popup.website)})`));
  }

  if (popup.links && popup.links.length > 0) {
    for (const item of popup.links) {
      actions.appendChild(createCtaButton(item.url, item.label));
    }
  }

  if (actions.childElementCount > 0) {
    inner.appendChild(actions);
  }

  card.appendChild(inner);
  return card;
}

