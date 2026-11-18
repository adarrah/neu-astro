import Parser from 'rss-parser';
import newsConfig from '../data/news-sources.json';

export type CommunityAreaId = keyof typeof newsConfig.communityAreas;
export type PillarId = keyof typeof newsConfig.pillars;

export interface NewsSourceConfig {
	id: string;
	name: string;
	publisher?: string;
	feedUrl: string;
	feedUrls?: string[];
	defaultCommunityAreas?: CommunityAreaId[];
	siteUrl: string;
}

export interface NewsArticle {
	id: string;
	title: string;
	url: string;
	publishedAt: string;
	sourceId: string;
	sourceName: string;
	author?: string;
	summary: string;
	imageUrl?: string;
	communityAreas: CommunityAreaId[];
	pillars: PillarId[];
}

interface MediaNode {
	$?: {
		url?: string;
		type?: string;
		medium?: string;
	};
}

type RawCategory =
	| string
	| {
			_?: string;
			$?: {
				term?: string;
				label?: string;
			};
	  };

interface ExtendedFeedItem extends Parser.Item {
	contentEncoded?: string;
	mediaContent?: MediaNode[];
	mediaThumbnail?: MediaNode[];
	rawCategories?: RawCategory[];
}

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_ARTICLES_PER_SOURCE = 15;
const FEED_TIMEOUT_MS = 10000;
const FUZZY_DUPLICATE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const IMAGE_URL_PATTERN = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const DIGEST_PREFIX_PATTERN = /^(?:the\s+(?:rundown|byline)|morning\s+shift|listen|watch):\s*/i;

const TITLE_STOPWORDS = new Set([
	'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'had',
	'are', 'was', 'were', 'will', 'would', 'could', 'should', 'into', 'onto',
	'over', 'under', 'after', 'before', 'about', 'what', 'when', 'where', 'which',
	'who', 'whom', 'whose', 'why', 'how', 'your', 'their', 'there', 'here', 'more',
	'most', 'some', 'such', 'than', 'then', 'them', 'they', 'these', 'those', 'its',
	'our', 'out', 'new', 'now', 'one', 'two', 'three', 'first', 'last', 'next',
	'open', 'opens', 'opening', 'chicago', 'chicagos', 'rundown', 'byline',
]);

const FEED_REQUEST_HEADERS = {
	'User-Agent': 'NEU-Astro-NewsAggregator/1.0 (+https://neighborsofedgewateruptown.org)',
	Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
};

const parser = new Parser<Record<string, never>, ExtendedFeedItem>({
	customFields: {
		item: [
			['content:encoded', 'contentEncoded'],
			['media:content', 'mediaContent', { keepArray: true }],
			['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
			['category', 'rawCategories', { keepArray: true }],
		],
	},
});

function decodeEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_, dec) => {
			const code = Number(dec);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		})
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
			const code = parseInt(hex, 16);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		})
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>');
}

function stripHtml(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

function extractImageAltText(html: string): string {
	const alts: string[] = [];
	const regex = /<img[^>]+alt=["']([^"']+)["']/gi;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(html)) !== null) {
		if (match[1]) alts.push(decodeEntities(match[1]));
	}
	return alts.join(' ');
}

function truncate(text: string, maxLen = 200): string {
	if (text.length <= maxLen) return text;
	const cut = text.slice(0, maxLen).replace(/\s+\S*$/, '');
	return `${cut}...`;
}

function isImageMedia(node: MediaNode): boolean {
	const url = node.$?.url;
	if (!url) return false;
	return (
		node.$?.medium === 'image' ||
		Boolean(node.$?.type?.startsWith('image/')) ||
		IMAGE_URL_PATTERN.test(url)
	);
}

function cleanImageUrl(url: string): string {
	return decodeEntities(url.trim());
}

function extractImageUrl(item: ExtendedFeedItem): string | undefined {
	if (
		item.enclosure?.url &&
		(item.enclosure.type?.startsWith('image/') || IMAGE_URL_PATTERN.test(item.enclosure.url))
	) {
		return cleanImageUrl(item.enclosure.url);
	}

	const mediaImg = item.mediaContent?.find(isImageMedia)?.$?.url;
	if (mediaImg) {
		return cleanImageUrl(mediaImg);
	}

	const contentEncoded =
		item.contentEncoded ?? (item as Record<string, unknown>)['content:encoded']?.toString();
	for (const html of [contentEncoded, item.content, item.summary]) {
		if (!html) continue;
		const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
		if (imgMatch?.[1]) {
			return cleanImageUrl(imgMatch[1]);
		}
	}

	const thumbUrl = item.mediaThumbnail?.find((t) => Boolean(t.$?.url))?.$?.url;
	if (thumbUrl) {
		return cleanImageUrl(thumbUrl).replace(/\/s\d+-c\//, '/s800/');
	}

	return undefined;
}

function extractCategories(item: ExtendedFeedItem): string[] {
	const raw = [...(item.categories ?? []), ...(item.rawCategories ?? [])];
	const labels: string[] = [];
	for (const entry of raw) {
		if (typeof entry === 'string') {
			const cleaned = decodeEntities(entry).trim();
			if (cleaned) labels.push(cleaned);
		} else if (entry && typeof entry === 'object') {
			const label = entry._ ?? entry.$?.term ?? entry.$?.label;
			if (typeof label === 'string' && label.trim()) {
				labels.push(decodeEntities(label).trim());
			}
		}
	}
	return Array.from(new Set(labels));
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCategories<T extends string>(
	haystack: string,
	definitions: Record<T, { label: string; keywords: string[] }>
): T[] {
	const lower = haystack.toLowerCase();
	const matched: T[] = [];
	for (const [id, def] of Object.entries(definitions) as Array<
		[T, { label: string; keywords: string[] }]
	>) {
		const isMatch = def.keywords.some((kw) => {
			const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(kw.toLowerCase())}(?![a-z0-9])`);
			return pattern.test(lower);
		});
		if (isMatch) {
			matched.push(id);
		}
	}
	return matched;
}

function inferAreasFromFeedUrl(feedUrl: string): CommunityAreaId[] {
	const lower = feedUrl.toLowerCase();
	const areaIds = Object.keys(newsConfig.communityAreas) as CommunityAreaId[];
	return areaIds.filter((id) =>
		new RegExp(`(?<![a-z0-9])${escapeRegExp(id.toLowerCase())}(?![a-z0-9])`).test(lower)
	);
}

/**
 * Escapes raw `<img ...>` XML child elements inside Atom `<content type="html">`
 * blocks before parsing with xml2js so image tags and alt captions are preserved
 * inside `item.content` rather than discarded as separate XML nodes.
 */
function escapeAtomHtmlTags(xml: string): string {
	return xml.replace(
		/(<content\b[^>]*\btype=["']html["'][^>]*>)([\s\S]*?)(<\/content>)/gi,
		(fullMatch, openTag: string, inner: string, closeTag: string) => {
			if (inner.includes('<![CDATA[')) return fullMatch;
			const escaped = inner.replace(/<img\b([^>]*?)\/?\s*>/gi, '&lt;img$1 /&gt;');
			return `${openTag}${escaped}${closeTag}`;
		}
	);
}

async function fetchAndParseFeed(url: string) {
	const response = await fetch(url, {
		headers: FEED_REQUEST_HEADERS,
		redirect: 'follow',
		signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}
	const xml = escapeAtomHtmlTags(await response.text());
	return parser.parseString(xml);
}

function getFeedUrlsForSource(source: NewsSourceConfig): string[] {
	if (source.feedUrls && source.feedUrls.length > 0) {
		return source.feedUrls;
	}
	// Automatically expand WordPress `/feed` endpoints without query strings to include
	// neighborhood searches so newly added WordPress sources populate Edgewater/Uptown posts.
	if (/\/feed\/?$/i.test(source.feedUrl)) {
		return [
			source.feedUrl,
			`${source.feedUrl}?s=edgewater`,
			`${source.feedUrl}?s=uptown`,
		];
	}
	return [source.feedUrl];
}

function getCanonicalUrlKey(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl.trim());
		parsed.protocol = 'https:';
		parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
		for (const param of Array.from(parsed.searchParams.keys())) {
			const lowerParam = param.toLowerCase();
			if (lowerParam.startsWith('utm_') || lowerParam === 'fbclid' || lowerParam === 'gclid') {
				parsed.searchParams.delete(param);
			}
		}
		parsed.hash = '';
		parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
		return parsed.toString().toLowerCase();
	} catch {
		return rawUrl.trim().replace(/\/+$/, '').toLowerCase();
	}
}

function getGuidKey(rawId: string): string {
	const trimmed = rawId.trim();
	if (!trimmed) return '';
	if (/^https?:\/\//i.test(trimmed)) {
		return getCanonicalUrlKey(trimmed);
	}
	return trimmed.toLowerCase();
}

function getUrlSlugKey(rawUrl: string): string {
	let pathname: string;
	try {
		pathname = new URL(rawUrl.trim()).pathname.replace(/\/+$/, '').toLowerCase();
	} catch {
		pathname = rawUrl.trim().replace(/\/+$/, '').toLowerCase();
	}
	const datedSlugMatch = pathname.match(/\/(\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+)$/);
	if (datedSlugMatch?.[1]) {
		return datedSlugMatch[1];
	}
	const segments = pathname.split('/').filter(Boolean);
	if (segments.length > 0) {
		const last = segments[segments.length - 1].replace(/\.html?$/, '');
		if (last.length >= 16) {
			return last;
		}
	}
	return pathname;
}

function getNormalizedTitleKey(title: string): string {
	return title
		.trim()
		.replace(DIGEST_PREFIX_PATTERN, '')
		.replace(/[^a-z0-9]+/gi, ' ')
		.trim()
		.toLowerCase();
}

function getTitleTokens(title: string): Set<string> {
	const normalized = getNormalizedTitleKey(title);
	const tokens = new Set<string>();
	for (const word of normalized.split(/\s+/)) {
		if (word.length >= 3 && !TITLE_STOPWORDS.has(word) && !/^\d+$/.test(word)) {
			tokens.add(word);
		}
	}
	return tokens;
}

function getCanonicalImageKey(imageUrl?: string): string {
	if (!imageUrl) return '';
	try {
		const parsed = new URL(imageUrl.trim());
		const proxiedUrl = parsed.searchParams.get('url');
		let path = proxiedUrl ? new URL(proxiedUrl).pathname.toLowerCase() : parsed.pathname.toLowerCase();
		path = path.replace(/-\d+x\d+(?=\.[a-z]+$)/, '');
		path = path.replace(/(\d{4,6})-\d{1,2}(?=\.[a-z]+$)/, '$1');
		return path;
	} catch {
		return imageUrl.trim().split('?')[0].toLowerCase();
	}
}

function getSeriesKey(publisherId: string, title: string): string {
	if (/\bthings to do in chicago this weekend\b/i.test(title)) {
		return `${publisherId}:weekend-things-to-do`;
	}
	const shopLocalMatch = title.match(/^(shop local \d{4}):/i);
	if (shopLocalMatch?.[1]) {
		return `${publisherId}:${shopLocalMatch[1].toLowerCase()}`;
	}
	return '';
}

function getPublisherId(
	sourceId: string,
	sourcesById: Map<string, NewsSourceConfig>
): string {
	return sourcesById.get(sourceId)?.publisher ?? sourceId;
}

function compareArticlePreference(a: NewsArticle, b: NewsArticle): number {
	const aIsDigest =
		/\/wbez-newsletter\//i.test(a.url) || /^the rundown:/i.test(a.title.trim());
	const bIsDigest =
		/\/wbez-newsletter\//i.test(b.url) || /^the rundown:/i.test(b.title.trim());
	if (aIsDigest !== bIsDigest) {
		return Number(aIsDigest) - Number(bIsDigest);
	}

	const aHasNeighborhood = /\b(edgewater|uptown|andersonville)\b/i.test(a.title);
	const bHasNeighborhood = /\b(edgewater|uptown|andersonville)\b/i.test(b.title);
	if (aHasNeighborhood !== bHasNeighborhood) {
		return Number(bHasNeighborhood) - Number(aHasNeighborhood);
	}

	return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function mergeArticleMetadata(target: NewsArticle, duplicate: NewsArticle): void {
	for (const area of duplicate.communityAreas) {
		if (!target.communityAreas.includes(area)) {
			target.communityAreas.push(area);
		}
	}
	for (const pillar of duplicate.pillars) {
		if (!target.pillars.includes(pillar)) {
			target.pillars.push(pillar);
		}
	}
	if (!target.imageUrl && duplicate.imageUrl) {
		target.imageUrl = duplicate.imageUrl;
	}
	if (!target.author && duplicate.author) {
		target.author = duplicate.author;
	}
}

function deduplicateArticles(
	articles: NewsArticle[],
	sourcesById: Map<string, NewsSourceConfig>
): NewsArticle[] {
	const prioritized = [...articles].sort(compareArticlePreference);
	const keyToArticle = new Map<string, NewsArticle>();
	const accepted: NewsArticle[] = [];
	const acceptedTokens = new Map<NewsArticle, Set<string>>();

	for (const article of prioritized) {
		const publisherId = getPublisherId(article.sourceId, sourcesById);
		const keys: string[] = [
			`url:${getCanonicalUrlKey(article.url)}`,
			`title:${getNormalizedTitleKey(article.title)}`,
		];

		const guidKey = getGuidKey(article.id);
		if (guidKey) keys.push(`guid:${guidKey}`);

		const slugKey = getUrlSlugKey(article.url);
		if (slugKey) keys.push(`slug:${slugKey}`);

		const imgKey = getCanonicalImageKey(article.imageUrl);
		if (imgKey) keys.push(`img:${imgKey}`);

		const seriesKey = getSeriesKey(publisherId, article.title);
		if (seriesKey) keys.push(`series:${seriesKey}`);

		let existing: NewsArticle | undefined;
		for (const key of keys) {
			const match = keyToArticle.get(key);
			if (match) {
				existing = match;
				break;
			}
		}

		const tokens = getTitleTokens(article.title);
		if (!existing && tokens.size >= 3) {
			const articleTime = new Date(article.publishedAt).getTime();
			for (const candidate of accepted) {
				if (getPublisherId(candidate.sourceId, sourcesById) !== publisherId) {
					continue;
				}
				const candidateTokens = acceptedTokens.get(candidate);
				if (!candidateTokens || candidateTokens.size < 3) {
					continue;
				}
				let intersection = 0;
				for (const tok of tokens) {
					if (candidateTokens.has(tok)) intersection++;
				}
				const overlap = intersection / Math.min(tokens.size, candidateTokens.size);
				const candidateTime = new Date(candidate.publishedAt).getTime();
				if (overlap >= 0.6 && Math.abs(articleTime - candidateTime) <= FUZZY_DUPLICATE_WINDOW_MS) {
					existing = candidate;
					break;
				}
			}
		}

		if (existing) {
			mergeArticleMetadata(existing, article);
			for (const key of keys) {
				keyToArticle.set(key, existing);
			}
			continue;
		}

		accepted.push(article);
		acceptedTokens.set(article, tokens);
		for (const key of keys) {
			keyToArticle.set(key, article);
		}
	}

	const sorted = accepted.sort(
		(a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
	);
	const perSourceCount = new Map<string, number>();
	return sorted.filter((article) => {
		const count = perSourceCount.get(article.sourceId) ?? 0;
		if (count >= MAX_ARTICLES_PER_SOURCE) return false;
		perSourceCount.set(article.sourceId, count + 1);
		return true;
	});
}

function normalizeItem(
	item: ExtendedFeedItem,
	source: NewsSourceConfig,
	feedUrl: string,
	cutoffMs: number
): NewsArticle | null {
	const title = decodeEntities((item.title ?? '').trim());
	const url = (item.link ?? '').trim();
	if (!title || !url) return null;

	const rawDate = item.isoDate ?? item.pubDate;
	if (!rawDate) return null;
	const parsedDate = new Date(rawDate);
	if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < cutoffMs) {
		return null;
	}
	const publishedAt = parsedDate.toISOString();

	const contentEncoded =
		item.contentEncoded ?? (item as Record<string, unknown>)['content:encoded']?.toString() ?? '';
	const rawHtmlParts = [item.summary ?? '', item.content ?? '', contentEncoded].join(' ');
	const categories = extractCategories(item);

	let urlPath = url;
	try {
		urlPath = new URL(url).pathname;
	} catch {
		urlPath = url;
	}
	const urlWords = urlPath.replace(/[^a-z0-9]+/gi, ' ');

	const rawText = [
		title,
		urlWords,
		...categories,
		stripHtml(item.contentSnippet ?? ''),
		stripHtml(rawHtmlParts),
		extractImageAltText(rawHtmlParts),
	].join(' ');

	let communityAreas = matchCategories<CommunityAreaId>(
		rawText,
		newsConfig.communityAreas as Record<
			CommunityAreaId,
			{ label: string; keywords: string[] }
		>
	);

	if (communityAreas.length === 0) {
		const feedUrlAreas = inferAreasFromFeedUrl(feedUrl);
		if (feedUrlAreas.length > 0) {
			communityAreas = feedUrlAreas;
		}
	}

	if (communityAreas.length === 0 && source.defaultCommunityAreas?.length) {
		communityAreas = [...source.defaultCommunityAreas];
	}

	// Filter citywide feeds to stories relevant to Edgewater or Uptown
	if (communityAreas.length === 0) return null;

	let pillars = matchCategories<PillarId>(
		rawText,
		newsConfig.pillars as Record<PillarId, { label: string; keywords: string[] }>
	);
	if (pillars.length === 0) {
		pillars = ['community'];
	}

	const summarySource =
		stripHtml(item.contentSnippet ?? '') ||
		stripHtml(item.summary ?? '') ||
		stripHtml(item.content ?? '') ||
		stripHtml(contentEncoded);
	const cleanedSummary = summarySource
		.replace(/\s*The post .+ appeared first on .+\.?$/i, '')
		.trim();

	return {
		id: item.guid ?? url,
		title,
		url,
		publishedAt,
		sourceId: source.id,
		sourceName: source.name,
		author: item.creator ? decodeEntities(item.creator).trim() : undefined,
		summary: truncate(cleanedSummary, 200),
		imageUrl: extractImageUrl(item),
		communityAreas,
		pillars,
	};
}

export interface FetchNewsResult {
	articles: NewsArticle[];
	feedErrors: Array<{ sourceName: string; message: string }>;
}

/**
 * Fetches and normalizes neighborhood news from all configured RSS/Atom sources
 * in `src/data/news-sources.json`, tagging each article by Community Area and NEU Pillar,
 * enforcing the configured lookback window and deduplicating syndicated stories.
 */
export async function fetchNeighborhoodNews(): Promise<FetchNewsResult> {
	const sources = newsConfig.sources as NewsSourceConfig[];
	const sourcesById = new Map(sources.map((s) => [s.id, s]));
	const lookbackDays =
		(newsConfig as { lookbackDays?: number }).lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
	const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

	const feedErrors: Array<{ sourceName: string; message: string }> = [];
	const candidates: NewsArticle[] = [];

	const sourceResults = await Promise.all(
		sources.map(async (source) => {
			const urls = getFeedUrlsForSource(source);
			const subResults = await Promise.allSettled(
				urls.map(async (feedUrl) => ({
					feedUrl,
					feed: await fetchAndParseFeed(feedUrl),
				}))
			);
			return { source, subResults };
		})
	);

	for (const { source, subResults } of sourceResults) {
		let succeededCount = 0;
		let firstError = '';

		for (const sub of subResults) {
			if (sub.status === 'rejected') {
				if (!firstError) {
					firstError = sub.reason instanceof Error ? sub.reason.message : String(sub.reason);
				}
				continue;
			}
			succeededCount++;
			const { feedUrl, feed } = sub.value;
			for (const rawItem of feed.items ?? []) {
				const normalized = normalizeItem(rawItem, source, feedUrl, cutoffMs);
				if (normalized) {
					candidates.push(normalized);
				}
			}
		}

		if (succeededCount === 0) {
			feedErrors.push({
				sourceName: source.name,
				message: firstError || 'Failed to fetch feed',
			});
		}
	}

	const articles = deduplicateArticles(candidates, sourcesById);
	return { articles, feedErrors };
}
