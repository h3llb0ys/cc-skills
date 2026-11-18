import { z } from 'zod';

export const sidebarAppearanceSchema = z.object({color:z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()}).strict();
export type SidebarAppearance = z.infer<typeof sidebarAppearanceSchema>;
