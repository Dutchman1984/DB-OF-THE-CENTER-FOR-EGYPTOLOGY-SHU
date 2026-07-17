import assert from "node:assert/strict";
import test from "node:test";

import worker, { runKeepAlive } from "../worker.mjs";

const schedule = {
  cron: "17 */6 * * *",
  scheduledTime: Date.parse("2026-07-17T12:17:00Z"),
};

test("keep-alive performs one authenticated read and accepts one id", async () => {
  let request;
  await runKeepAlive(
    { SUPABASE_ANON_KEY: "test-anon-key" },
    schedule,
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  assert.match(request.url, /select=id/);
  assert.match(request.url, /limit=1/);
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.apikey, "test-anon-key");
  assert.equal(request.init.headers.Authorization, "Bearer test-anon-key");
});

test("keep-alive fails closed when the secret is absent", async () => {
  await assert.rejects(
    runKeepAlive({}, schedule, async () => new Response("[]")),
    /secret is not configured/,
  );
});

test("keep-alive rejects an HTTP error", async () => {
  await assert.rejects(
    runKeepAlive(
      { SUPABASE_ANON_KEY: "test-anon-key" },
      schedule,
      async () => new Response("unauthorized", { status: 401 }),
    ),
    /HTTP 401/,
  );
});

test("keep-alive rejects an unexpected payload", async () => {
  await assert.rejects(
    runKeepAlive(
      { SUPABASE_ANON_KEY: "test-anon-key" },
      schedule,
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
    /unexpected payload/,
  );
});

test("scheduled handler registers the keep-alive promise", async () => {
  let promise;
  const ctx = {
    waitUntil(value) {
      promise = value;
    },
  };

  await worker.scheduled(
    { cron: schedule.cron, scheduledTime: schedule.scheduledTime },
    {},
    ctx,
  );

  assert.ok(promise instanceof Promise);
  await assert.rejects(promise, /secret is not configured/);
});

test("fetch handler delegates unchanged requests to the assets binding", async () => {
  const request = new Request("https://shu-egyptology-db.site/");
  const expected = new Response("asset", { status: 200 });
  const actual = await worker.fetch(request, {
    ASSETS: {
      fetch(received) {
        assert.equal(received, request);
        return expected;
      },
    },
  });

  assert.equal(actual, expected);
});
