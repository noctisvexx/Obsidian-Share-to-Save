import { parse } from 'acorn';
import { list, object, string } from './shared';
import type { Data } from './shared';

// Interpret literals only. Calls, functions, getters, operators and remote code
// are never run; Acorn supplies syntax parsing for the serialized SSR graph.
export function scriptObjects(html: string, wantedKey: string, wantedValue: string): Data[] {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const results: Data[] = [];
	for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
		const text = script.textContent || '';
		if (!text.includes(wantedValue) || text.length > 1500000) continue;
		try {
			const tree: unknown = parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
			const nodes: Data[] = [], stack: unknown[] = [tree];
			while (stack.length && nodes.length < 50000) {
				const node = object(stack.pop()); if (!node.type) continue;
				nodes.push(node);
				for (const value of Object.values(node)) {
					if (Array.isArray(value)) stack.push(...list(value));
					else if (value && typeof value === 'object') stack.push(value);
				}
			}
			const reference = (node: unknown): string => {
				const value = object(node);
				if (value.type === 'Identifier') return string(value.name);
				if (value.type === 'MemberExpression' && object(value.object).type === 'Identifier' && object(value.property).type === 'Literal')
					return string(object(value.object).name) + '[' + String(object(value.property).value) + ']';
				return '';
			};
			const assignments = new Map<string, unknown>();
			for (const node of nodes) if (node.type === 'AssignmentExpression' && node.operator === '=') {
				const name = reference(node.left); if (name) assignments.set(name, node.right);
			}
			let budget = 20000;
			const read = (input: unknown, depth = 0, seen = new Set<unknown>()): unknown => {
				if (!input || depth > 70 || --budget < 0 || seen.has(input)) return undefined;
				seen = new Set(seen); seen.add(input);
				const node = object(input);
				if (node.type === 'Literal') return typeof node.value === 'string' || typeof node.value === 'number' || typeof node.value === 'boolean' || node.value === null ? node.value : undefined;
				if (node.type === 'AssignmentExpression' && node.operator === '=') return read(node.right, depth + 1, seen);
				if (node.type === 'ArrayExpression') return list(node.elements).map(value => read(value, depth + 1, seen));
				if (node.type === 'UnaryExpression' && node.operator === '!' && object(node.argument).type === 'Literal') return !object(node.argument).value;
				if (node.type === 'ObjectExpression') {
					const result: Data = {};
					for (const value of list(node.properties)) {
						const prop = object(value); if (prop.type !== 'Property' || prop.kind !== 'init' || prop.computed) continue;
						const key = object(prop.key); const name = string(key.name) || string(key.value);
						if (name && !['__proto__', 'prototype', 'constructor'].includes(name)) result[name] = read(prop.value, depth + 1, seen);
					}
					return result;
				}
				const name = reference(node);
				return name && assignments.has(name) ? read(assignments.get(name), depth + 1, seen) : undefined;
			};
			for (const node of nodes) {
				if (node.type === 'Literal' && typeof node.value === 'string' && node.value.includes(wantedValue) && (node.value.trim().startsWith('{') || node.value.trim().startsWith('['))) {
					try { results.push(object(JSON.parse(node.value) as unknown)); } catch { /* Only a literal JSON string. */ }
				}
				if (node.type !== 'ObjectExpression') continue;
				const match = list(node.properties).some(value => {
					const prop = object(value), key = object(prop.key), val = object(prop.value);
					return (key.name === wantedKey || key.value === wantedKey) && val.type === 'Literal' && val.value === wantedValue;
				});
				if (match) results.push(object(read(node)));
			}
		} catch { /* Unsupported script syntax is not a reason to execute it. */ }
	}
	return results;
}
