import { readFileSync } from 'node:fs';
export const fixture = () => structuredClone(JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url))));
