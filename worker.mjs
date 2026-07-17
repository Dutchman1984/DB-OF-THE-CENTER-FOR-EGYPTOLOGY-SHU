const KEEPALIVE_URL =
  "https://api.shu-egyptology-db.site/rest/v1/alignments?select=id&order=id.asc&limit=1";

export async function runKeepAlive(env, schedule, fetchImpl = fetch) {
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY secret is not configured");
  }

  const response = await fetchImpl(KEEPALIVE_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Cache-Control": "no-store",
      "User-Agent": "Corpus-Aegyptiacum-keepalive/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase keep-alive failed with HTTP ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id) {
    throw new Error("Supabase keep-alive returned an unexpected payload");
  }

  console.log(
    JSON.stringify({
      event: "supabase_keepalive_ok",
      status: response.status,
      row_count: rows.length,
      cron: schedule.cron,
      scheduled_time: new Date(schedule.scheduledTime).toISOString(),
    }),
  );
}

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runKeepAlive(env, {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      }),
    );
  },
};
