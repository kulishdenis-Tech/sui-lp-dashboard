function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => {
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        });
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            }
            catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}
function isPoolQuotePath(req) {
    const raw = `${req.originalUrl ?? ''} ${req.url ?? ''}`;
    return raw.includes('/api/pool-quote');
}
export function poolQuoteApiPlugin() {
    return {
        name: 'pool-quote-api',
        enforce: 'pre',
        configureServer(server) {
            const handle = async (req, res, next) => {
                if (!isPoolQuotePath(req)) {
                    next();
                    return;
                }
                if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'method not allowed' }));
                    return;
                }
                try {
                    const body = (await readJsonBody(req));
                    const venue = body.venue;
                    if ((venue !== 'cetus' && venue !== 'turbos') || !body.poolId || !body.tokenIn || !body.amountIn) {
                        res.statusCode = 400;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ ok: false, error: 'invalid_body' }));
                        return;
                    }
                    const mod = await server.ssrLoadModule('/src/services/server/quotePoolImpact.ts');
                    const quotePoolImpact = mod.quotePoolImpact;
                    const out = await quotePoolImpact({
                        venue,
                        poolId: body.poolId,
                        tokenIn: body.tokenIn,
                        amountIn: body.amountIn,
                    });
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(out));
                }
                catch (e) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
                }
            };
            return () => {
                ;
                server.middlewares.stack.unshift({
                    route: '',
                    handle,
                });
            };
        },
    };
}
