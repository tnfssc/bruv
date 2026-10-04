import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCancellationChronology } from "../scripts/claude-native-acceptance/driver.mjs";

test("visibility alone cannot pass the observed wrong native cancellation chronology", () => {
  assert.doesNotThrow(() =>
    assertCancellationChronology("ACCEPT_CANCEL: request\nCANCEL_CONFIRMED_REAL\nCANCELLATION_COMPLETED_REAL"),
  );
  assert.throws(() =>
    assertCancellationChronology("CANCELLATION_COMPLETED_REAL\nACCEPT_CANCEL: request\nCANCEL_CONFIRMED_REAL"),
  );
  assert.throws(() => assertCancellationChronology("ACCEPT_CANCEL: request\nCANCELLATION_COMPLETED_REAL"));
});
