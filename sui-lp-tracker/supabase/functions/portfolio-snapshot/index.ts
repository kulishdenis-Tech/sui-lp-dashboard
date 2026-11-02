import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/** Skip dispatch when a snapshot landed recently (local writer or prior GHA). GHA skips incomplete upserts. */
const MIN_INTERVAL_MS = 90 * 60 * 1000;

type Json = Record<string, unknown>;

function json(status: number, body: Json, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
      ...extraHeaders,
    },
  });
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "supabase_env_missing" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const readSecret = async (name: string): Promise<string | null> => {
    const fromEnv = Deno.env.get(name.toUpperCase())?.trim()
      || Deno.env.get(name)?.trim();
    if (fromEnv) return fromEnv;
    const { data, error } = await admin.rpc("portfolio_runtime_secret", {
      secret_name: name,
    });
    if (error) {
      console.error("vault_read_failed", name, error.message);
      return null;
    }
    return typeof data === "string" && data.length > 0 ? data : null;
  };

  const cronSecret = await readSecret("portfolio_cron_secret");
  if (!cronSecret) {
    return json(503, { error: "cron_secret_not_configured" });
  }

  const provided = bearerToken(req);
  if (!provided || provided !== cronSecret) {
    return json(401, { error: "unauthorized" });
  }

  const force =
    new URL(req.url).searchParams.get("force") === "1" ||
    (req.headers.get("x-force-snapshot") ?? "") === "1";

  try {
    if (!force) {
      const { data: newestRows, error: newestErr } = await admin
        .from("portfolio_snapshots")
        .select("ts")
        .order("ts", { ascending: false })
        .limit(1);
      if (newestErr) throw newestErr;
      const newest = newestRows?.[0]?.ts;
      if (typeof newest === "number" && Number.isFinite(newest)) {
        const ageMs = Date.now() - newest;
        if (ageMs >= 0 && ageMs < MIN_INTERVAL_MS) {
          return json(200, {
            ok: true,
            skipped: true,
            reason: "fresh_snapshot",
            ageMs,
            minIntervalMs: MIN_INTERVAL_MS,
          });
        }
      }
    }

    const token = await readSecret("github_dispatch_token");
    const repo =
      (await readSecret("github_dispatch_repo")) ||
      "kulishdenis-Tech/sui-lp-dashboard";
    const workflow =
      (await readSecret("github_dispatch_workflow")) ||
      "portfolio-snapshot.yml";
    const ref = (await readSecret("github_dispatch_ref")) || "master";

    if (!token) {
      return json(503, {
        error: "GITHUB_DISPATCH_TOKEN not configured",
        hint: "Store github_dispatch_token in vault (or Edge secret)",
      });
    }

    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
    const gh = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref }),
    });

    if (gh.status !== 204 && gh.status !== 200) {
      const text = await gh.text();
      return json(502, {
        error: "github_dispatch_failed",
        status: gh.status,
        body: text.slice(0, 500),
      });
    }

    return json(200, {
      ok: true,
      dispatched: true,
      repo,
      workflow,
      ref,
      forced: force,
    });
  } catch (e) {
    return json(500, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
});
