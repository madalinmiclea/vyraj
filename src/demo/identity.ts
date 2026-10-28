export const DEMO_ID = 1;

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const demoToken = (name: string, scopes: string[]) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: `CHARACTER:EVE:${DEMO_ID}`, name, scp: scopes })}.demo`;

export const isDemoAuth = (auth: string | null) => !!auth && auth.startsWith('Bearer ') && auth.endsWith('.demo');
