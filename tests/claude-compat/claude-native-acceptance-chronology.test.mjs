import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCancellationChronology,
  expandRunDisclosure,
  timelineTextInVisualOrder,
} from "../../scripts/claude-native-acceptance/driver.mjs";

test("visibility alone cannot pass the observed wrong native cancellation chronology", () => {
  assert.doesNotThrow(() =>
    assertCancellationChronology("ACCEPT_CANCEL: request\nCANCEL_CONFIRMED_REAL\nCANCELLATION_COMPLETED_REAL"),
  );
  assert.throws(() =>
    assertCancellationChronology("CANCELLATION_COMPLETED_REAL\nACCEPT_CANCEL: request\nCANCEL_CONFIRMED_REAL"),
  );
  assert.throws(() => assertCancellationChronology("ACCEPT_CANCEL: request\nCANCELLATION_COMPLETED_REAL"));
});

// Exact2644 uses LegendList: recycled DOM slot order is not visual order.
test("recycled DOM slots preserve strict visual cancellation chronology", () => {
  const rows = [
    { top: 770, text: "CANCELLATION_COMPLETED_REAL" },
    { top: 580, text: "ACCEPT_CANCEL: request" },
    { top: 738, text: "CANCEL_CONFIRMED_REAL" },
  ];
  assert.throws(() => assertCancellationChronology(rows.map((row) => row.text).join("\n")));
  assert.doesNotThrow(() => assertCancellationChronology(timelineTextInVisualOrder(rows)));
});

test("visual ordering cannot replace a missing cancellation acknowledgement", () => {
  const rows = [
    { top: 770, text: "CANCELLATION_COMPLETED_REAL" },
    { top: 580, text: "ACCEPT_CANCEL: request" },
  ];
  assert.throws(() => assertCancellationChronology(timelineTextInVisualOrder(rows)));
});

test("visual ordering rejects cancellation completion above its request", () => {
  const rows = [
    { top: 500, text: "CANCELLATION_COMPLETED_REAL" },
    { top: 580, text: "ACCEPT_CANCEL: request" },
    { top: 738, text: "CANCEL_CONFIRMED_REAL" },
  ];
  assert.throws(() => assertCancellationChronology(timelineTextInVisualOrder(rows)));
});

test("disclosure selection uses the actual run, not the last recycled DOM slot", async () => {
  const calls = [];
  let expanded = "false";
  const page = {
    locator(selector) {
      calls.push(selector);
      return {
        getByRole(role, options) {
          assert.equal(role, "button");
          assert.ok(options.name.test("Worked for 1.3s"));
          return {
            getAttribute: async () => expanded,
            click: async () => {
              expanded = "true";
            },
          };
        },
      };
    },
  };
  await expandRunDisclosure(page, "actual-source-run");
  assert.deepEqual(calls, ['[data-timeline-row-id="turn-fold:actual-source-run"]']);
  assert.equal(expanded, "true");
  await assert.rejects(() => expandRunDisclosure(page, undefined), /Actual cancellation run identity/);
});
