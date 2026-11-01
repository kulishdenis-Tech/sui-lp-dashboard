export async function fetchPoolQuote(req) {
    const res = await fetch('/api/pool-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });
    if (!res.ok) {
        const err = (await res.json().catch(() => ({})));
        return { ok: false, error: err.error ?? `http_${res.status}` };
    }
    return (await res.json());
}
