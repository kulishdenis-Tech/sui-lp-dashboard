/** Base URL for same-deployment API routes when running on Vercel serverless/cron. */
export function deploymentOrigin() {
    if (typeof window !== 'undefined')
        return null;
    const vercel = process.env.VERCEL_URL;
    if (vercel)
        return `https://${vercel}`;
    const custom = process.env.SERVER_PUBLIC_URL;
    if (custom)
        return custom.replace(/\/$/, '');
    return null;
}
export function apiUrl(path) {
    const origin = deploymentOrigin();
    const p = path.startsWith('/') ? path : `/${path}`;
    if (origin)
        return `${origin}${p}`;
    return p;
}
