import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const ltes = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/ltes' }),
	schema: z.object({
		title: z.string(),
		pubDate: z.coerce.date(),
		author: z.string().default('Neighbors of Edgewater and Uptown'),
		category: z.string().default('Letters to the Editor'),
		permalink: z.string(),
		excerpt: z.string(),
		featuredImage: z
			.object({
				url: z.string(),
				alt: z.string(),
			})
			.optional(),
	}),
});

export const collections = { ltes };

