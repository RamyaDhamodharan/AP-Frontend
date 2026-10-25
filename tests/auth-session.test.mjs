import assert from "node:assert/strict";
import { test } from "node:test";

import { createAuthSession } from "../src/authSession.ts";

test("session restoration obtains and keeps an access token in memory", async () => {
  const session = createAuthSession(async () => "restored-access-token");

  assert.equal(session.getAccessToken(), "");
  assert.equal(await session.restore(), "restored-access-token");
  assert.equal(session.getAccessToken(), "restored-access-token");
});

test("concurrent refresh requests share a single cookie-backed request", async () => {
  let calls = 0;
  let resolveRefresh;
  const session = createAuthSession(() => {
    calls += 1;
    return new Promise(resolve => { resolveRefresh = resolve; });
  });

  const first = session.refresh();
  const second = session.refresh();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRefresh("rotated-access-token");
  assert.deepEqual(await Promise.all([first, second]), [
    "rotated-access-token",
    "rotated-access-token",
  ]);
});

test("failed restoration leaves no access token in memory", async () => {
  const session = createAuthSession(async () => null);

  assert.equal(await session.restore(), null);
  assert.equal(session.getAccessToken(), "");
});
