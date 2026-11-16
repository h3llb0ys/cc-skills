import { z } from 'zod';

// Fixed outline vocabulary; no remote assets or arbitrary SVG input.
export const icons = {
 folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z',
 code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',
 terminal: 'M3 4h18v16H3Zm4 4 4 4-4 4m6 0h4',
 box: 'm12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5m-9 5v9M7 5.8l10 5.5',
 database: 'M21 6c0 2-4 3-9 3S3 8 3 6s4-3 9-3 9 1 9 3Zm0 0v12c0 2-4 3-9 3s-9-1-9-3V6m0 6c0 2 4 3 9 3s9-1 9-3',
 globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
 layers: 'm12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 briefcase: 'M3 7h18v14H3Zm5 0V3h8v4M3 12h18m-9-2v4',
 wrench: 'm14 6 4 4 3-3a6 6 0 0 1-8 7l-7 7-3-3 7-7a6 6 0 0 1 7-8Z',
 rocket: 'M9 15 5 19m4-4-3-3c2-6 7-9 14-9 0 7-3 12-9 14Zm-3-3H2l4-5h5m-2 8v7l5-4v-4M15 7h2',
 star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
 heart: 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 3 12 8 16 5-4 13-11 8-16Z',
 bot: 'M4 7h16v13H4Zm8 0V3m-2 0h4M1 11v5m22-5v5M8 11v2m8-2v2m-8 3h8',
 book: 'M12 5C8 3 5 3 2 4v16c3-1 6-1 10 1 4-2 7-2 10-1V4c-3-1-6-1-10 1Zm0 0v16',
 sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM3 2v4M1 4h4m15 14v4m-2-2h4',
 flag: 'M4 22V3c6-4 10 4 16 0v11c-6 4-10-4-16 0',
} as const;
export type IconName = keyof typeof icons;
export const palette = ['#808080', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#8b5cf6', '#ec4899'];
export const appearanceSchema = z.object({
 color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
 icon: z.enum(Object.keys(icons) as [IconName, ...IconName[]]).nullable(),
 emoji: z.string().trim().max(16).refine(s => !s || /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u.test(s) && /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[0-9#*\u200d\ufe0f\u20e3])+$/u.test(s), 'Введите эмодзи').nullable(),
}).strict().refine(s => !(s.icon && s.emoji), 'Выберите значок или эмодзи');
export type Appearance = z.infer<typeof appearanceSchema>;
export const emptyAppearance: Appearance = {color:null, icon:null, emoji:null};
export const targetSchema = z.string().regex(/^(?:project|section):[a-zA-Z0-9_-]{1,160}$/);
export type Target = {key:string; name:string};
export function iconData(name: IconName) {
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name]}"/></svg>`;
 return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
