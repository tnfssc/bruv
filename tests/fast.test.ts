import { expect, test } from "bun:test";
import { registerFast } from "../src/fast";
import { sdk } from "./sdk";

test("fast confirms once, restores its flag, and changes only Responses requests", async () => {
  let confirms = 0;
  let accepted = false;
  let isFast = () => false;
  const previous = process.env.BRUV_FAST;
  delete process.env.BRUV_FAST;
  const app = await sdk(
    [
      (pi) => {
        isFast = registerFast(pi);
      },
    ],
    {
      confirm: async () => {
        confirms++;
        return accepted;
      },
    },
  );
  try {
    await app.session.prompt("/fast on");
    expect(isFast()).toBe(false);
    expect(confirms).toBe(0);
    for (const api of ["openai-responses", "openai-codex-responses"]) {
      await app.session.setModel({ ...app.faux.getModel(), id: api, api });
      await app.session.prompt("/fast on");
      if (!accepted) {
        expect(isFast()).toBe(false);
        accepted = true;
        await app.session.prompt("/fast on");
      }
      const payload = { model: "test", input: [] };
      expect(await app.session.extensionRunner.emitBeforeProviderRequest(payload)).toMatchObject({
        service_tier: "priority",
      });
      await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
      expect(isFast()).toBe(true);
      await app.session.prompt("/fast off");
      expect(await app.session.extensionRunner.emitBeforeProviderRequest({ input: [] })).toEqual({ input: [] });
    }
    expect(confirms).toBe(2);
    await app.session.prompt("/fast on");
    await app.session.setModel(app.faux.getModel());
    expect(isFast()).toBe(false);
    expect(await app.session.extensionRunner.emitBeforeProviderRequest({ input: [] })).toEqual({ input: [] });
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRUV_FAST;
    else process.env.BRUV_FAST = previous;
  }
});

test("child fast starts on without a dialog and can be turned off", async () => {
  const previous = process.env.BRUV_FAST;
  process.env.BRUV_FAST = "1";
  let confirms = 0;
  let isFast = () => false;
  const app = await sdk(
    [
      (pi) => {
        isFast = registerFast(pi);
      },
    ],
    {
      confirm: async () => {
        confirms++;
        return false;
      },
    },
  );
  try {
    await app.session.setModel({ ...app.faux.getModel(), api: "openai-codex-responses" });
    await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    expect(isFast()).toBe(true);
    expect(confirms).toBe(0);
    await app.session.prompt("/fast off");
    await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    expect(isFast()).toBe(false);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRUV_FAST;
    else process.env.BRUV_FAST = previous;
  }
});
