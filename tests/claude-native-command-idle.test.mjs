import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForCommandIdle } from "../wisdom/claude-compat/proof/official-2644/command-driver.mjs";

function fixture({ stuck = null, converge = () => {} } = {}) {
  const visible = { "Stop generation": false, "Submit message": true, Working: true };
  const waits = [];
  const locator = (name) => ({
    isVisible: async () => visible[name],
    async waitFor(options) {
      waits.push({ name, ...options });
      converge(name, visible);
      if (name === stuck) throw Error(name + " did not converge before timeout");
      if (name === "Working") visible.Working = false;
      assert.equal(visible[name], options.state === "visible");
    },
  });
  return {
    visible,
    waits,
    page: {
      getByRole(role, { name, exact }) {
        assert.equal(role, "button");
        assert.equal(exact, true);
        return locator(name);
      },
      getByText(name, { exact }) {
        assert.equal(name, "Working");
        assert.equal(exact, true);
        return locator(name);
      },
    },
  };
}

test("correlated result/composer idle may precede sidebar idle: wait, do not sample once", async () => {
  const f = fixture();
  // The old immediate assertion fails at precisely the hosted mismatch.
  assert.throws(() => assert.equal(f.visible.Working, false));
  await waitForCommandIdle(f.page);
  assert.equal(f.visible.Working, false);
  assert.deepEqual(
    f.waits.map(({ name, state }) => [name, state]),
    [
      ["Stop generation", "hidden"],
      ["Submit message", "visible"],
      ["Working", "hidden"],
    ],
  );
});

test("all indicators share the existing 30-second deadline, without resetting it", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
  let now = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  try {
    const f = fixture({
      converge: () => {
        now += 4000;
      },
    });
    await waitForCommandIdle(f.page);
    assert.deepEqual(
      f.waits.map(({ timeout }) => timeout),
      [30000, 26000, 22000],
    );
    const expired = fixture({
      converge: () => {
        now += 30000;
      },
    });
    await assert.rejects(() => waitForCommandIdle(expired.page), /did not converge to idle within 30000ms/);
    assert.equal(expired.waits.length, 1);
  } finally {
    if (descriptor) Object.defineProperty(performance, "now", descriptor);
    else delete performance.now;
  }
});

for (const stuck of ["Working", "Stop generation", "Submit message"]) {
  test("persistent " + stuck + " mismatch is still rejected", async () => {
    const f = fixture({ stuck });
    await assert.rejects(() => waitForCommandIdle(f.page), /did not converge before timeout/);
  });
}
