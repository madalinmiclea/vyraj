export const VIEW_IDS = ['home', 'doctrines', 'orders', 'market', 'intel', 'recon', 'navigation', 'fitting', 'character', 'wallet', 'skins', 'pi', 'industry', 'mining', 'missions', 'cosmos', 'operations', 'mail', 'notifications', 'about'] as const;

export type ViewId = (typeof VIEW_IDS)[number];
