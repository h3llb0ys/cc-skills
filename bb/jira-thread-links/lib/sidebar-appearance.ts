import { z } from 'zod';

export const sidebarAppearanceSchema = z.object({color:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()}).strict();
export const palette = ['#808080', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#8b5cf6', '#ec4899'];
export type SidebarAppearance = z.infer<typeof sidebarAppearanceSchema>;
