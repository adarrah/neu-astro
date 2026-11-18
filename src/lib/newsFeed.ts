import Parser from 'rss-parser';
import newsConfig from '../data/news-sources.json';

export type CommunityAreaId = keyof typeof newsConfig.communityAreas;
export type PillarId = keyof typeof newsConfig.pillars;

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

const parser = new Parser({
	timeout: 6000,
	headers: {
		'User-Agent': 'NEU-Astro-NewsAggregator/1.0 (+https://neighborsofedgewateruptown.org)',
	},
});

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function truncate(text: string, maxLen = 200): string {
	if (text.length <= maxLen) return text;
	const cut = text.slice(0, maxLen).replace(/\s+\S*$/, '');
	return `${cut}...`;
}

function extractImageUrl(item: Parser.Item): string | undefined {
	if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
		return item.enclosure.url;
	}
	const rawHtml =
		(item as Record<string, unknown>)['content:encoded']?.toString() ??
		item.content ??
		'';
	const imgMatch = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
	return imgMatch?.[1];
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
		if (def.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
			matched.push(id);
		}
	}
	return matched;
}

function normalizeItem(
	item: Parser.Item,
	source: { id: string; name: string }
): NewsArticle | null {
	const title = (item.title ?? '').trim();
	const url = (item.link ?? '').trim();
	if (!title || !url) return null;

	const rawText = [
		title,
		...(item.categories ?? []),
		stripHtml(item.contentSnippet ?? item.content ?? ''),
	].join(' ');

	const communityAreas = matchCategories<CommunityAreaId>(
		rawText,
		newsConfig.communityAreas as Record<
			CommunityAreaId,
			{ label: string; keywords: string[] }
		>
	);

	// Filter citywide feeds to stories relevant to Edgewater or Uptown
	if (communityAreas.length === 0) return null;

	let pillars = matchCategories<PillarId>(
		rawText,
		newsConfig.pillars as Record<PillarId, { label: string; keywords: string[] }>
	);
	if (pillars.length === 0) {
		pillars = ['community'];
	}

	const summaryText = stripHtml(item.contentSnippet ?? item.content ?? '');
	const publishedAt = item.isoDate ?? item.pubDate ?? new Date().toISOString();

	return {
		id: item.guid ?? url,
		title,
		url,
		publishedAt: new Date(publishedAt).toISOString(),
		sourceId: source.id,
		sourceName: source.name,
		author: item.creator ?? undefined,
		summary: truncate(summaryText, 200),
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
 * in `src/data/news-sources.json`, tagging each article by Community Area and NEU Pillar.
 */
export async function fetchNeighborhoodNews(): Promise<FetchNewsResult> {
	const feedErrors: Array<{ sourceName: string; message: string }> = [];
	const byUrl = new Map<string, NewsArticle>();

	const results = await Promise.allSettled(
		newsConfig.sources.map(async (source) => {
			const feed = await parser.parseURL(source.feedUrl);
			return { source, items: feed.items ?? [] };
		})
	);

	for (let i = 0; i < results.length; i++) {
		const res = results[i];
		const source = newsConfig.sources[i];
		if (res.status === 'rejected') {
			feedErrors.push({
				sourceName: source.name,
				message: res.reason instanceof Error ? res.reason.message : String(res.reason),
			});
			continue;
		}
		for (const rawItem of res.value.items) {
			const normalized = normalizeItem(rawItem, source);
			if (normalized && !byUrl.has(normalized.url)) {
				byUrl.set(normalized.url, normalized);
			}
		}
	}

	const articles = Array.from(byUrl.values()).sort(
		(a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
	);

	return { articles, feedErrors };
}

