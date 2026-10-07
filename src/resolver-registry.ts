import type { ParsedContent } from './types';
import { QualityValidator } from './quality-validator';

export interface PlatformResolver {
	readonly name: string;
	matches(url: string): boolean;
	resolve(url: string): Promise<ParsedContent>;
}

export class ResolverRegistry {
	constructor(private resolvers: PlatformResolver[], private generic: PlatformResolver) {}
	async resolve(url: string): Promise<ParsedContent> {
		const errors: string[] = [];
		for (const resolver of [...this.resolvers.filter(r => r.matches(url)), this.generic]) {
			try {
				const content = await resolver.resolve(url);
				const quality = QualityValidator.validate(content);
				if (quality.valid) return content;
				errors.push(`${resolver.name}: ${quality.reason}`);
			} catch (error) { errors.push(`${resolver.name}: ${String(error)}`); }
		}
		throw new Error(errors.join('; ') || 'No usable content');
	}
}
