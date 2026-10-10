import { expect, mock, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { enableJobResponseAcknowledgement, JOB_RESPONSE_ACK_EVENT } from "../../src/job-delivery";
import { type ForegroundStopResult, requestForegroundStop } from "../../src/tasks/foreground-stop";

function foregroundStopFixture() {
  const delivery = new AbortController();
  enableJobResponseAcknowledgement(delivery.signal);
  const observations: ForegroundStopResult[] = [];
  const host = {
    isIdle: mock(() => false),
    abort: mock(() => {}),
    sessionManager: {
      getSessionId: mock(() => "owned"),
      getLeafId: mock(() => "leaf"),
    },
  };
  return {
    host,
    delivery,
    observations,
    requestStop: (isCurrent?: () => boolean) =>
      requestForegroundStop(
        {
          ...host,
          // Only these identity getters are used from the SDK's session manager.
          sessionManager: host.sessionManager as unknown as ExtensionContext["sessionManager"],
        },
        delivery.signal,
        (result) => observations.push(result),
        isCurrent,
      ),
    acknowledgeDelivery: () => delivery.signal.dispatchEvent(new Event(JOB_RESPONSE_ACK_EVENT)),
  };
}

test("foreground stop waits for result delivery, requests abort once, and still reports pending", () => {
  const { host, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  expect(requestStop()).toEqual({
    outcome: "pending",
    detail: "Foreground stop follows result delivery",
  });
  expect(host.abort).not.toHaveBeenCalled();
  expect(observations).toEqual([]);

  acknowledgeDelivery();
  expect(host.abort).toHaveBeenCalledTimes(1);
  // Requesting abort is not evidence that the foreground turn has ended.
  expect(observations).toEqual([{ outcome: "pending" }]);
  acknowledgeDelivery();
  expect(host.abort).toHaveBeenCalledTimes(1);
  expect(observations).toEqual([{ outcome: "pending" }]);
});

test("foreground stop cannot abort a different session after result delivery", () => {
  const { host, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  requestStop();
  host.sessionManager.getSessionId.mockReturnValue("foreign");

  acknowledgeDelivery();
  expect(host.abort).not.toHaveBeenCalled();
  expect(observations).toEqual([{ outcome: "error", detail: "Session or branch changed before stop" }]);
});

test("foreground stop cannot abort a different branch within the same session", () => {
  const { host, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  requestStop();
  host.sessionManager.getLeafId.mockReturnValue("other-leaf");

  acknowledgeDelivery();
  expect(host.abort).not.toHaveBeenCalled();
  expect(observations).toEqual([{ outcome: "error", detail: "Session or branch changed before stop" }]);
});

test("cancelled result delivery disarms foreground cancellation", () => {
  const { host, delivery, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  requestStop();
  delivery.abort();

  acknowledgeDelivery();
  expect(host.abort).not.toHaveBeenCalled();
  expect(observations).toEqual([]);
});

test("foreground abort failure is reported without exposing the thrown error", () => {
  const { host, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  requestStop();
  host.abort.mockImplementation(() => {
    throw Error("secret");
  });

  acknowledgeDelivery();
  expect(host.abort).toHaveBeenCalledTimes(1);
  expect(observations).toEqual([{ outcome: "error", detail: "Foreground stop failed" }]);
});

test("an idle host needs no foreground cancellation or delivery listener", () => {
  const { host, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  host.isIdle.mockReturnValue(true);
  expect(requestStop()).toEqual({ outcome: "idle" });

  acknowledgeDelivery();
  expect(host.abort).not.toHaveBeenCalled();
  expect(observations).toEqual([]);
});

test("foreground stop rechecks the active voice owner even when session and branch are unchanged", () => {
  const { host, observations, requestStop, acknowledgeDelivery } = foregroundStopFixture();
  const isCurrentOwner = mock(() => true);
  requestStop(isCurrentOwner);
  isCurrentOwner.mockReturnValue(false);

  acknowledgeDelivery();
  expect(isCurrentOwner).toHaveBeenCalledTimes(1);
  expect(host.abort).not.toHaveBeenCalled();
  expect(observations).toEqual([{ outcome: "error", detail: "Session or branch changed before stop" }]);
});
