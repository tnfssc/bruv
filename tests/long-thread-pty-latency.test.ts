import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { capturePane, shellQuote, tmuxRunner } from "./tui-helpers";
import { run } from "./helpers";

// Real compiled-terminal measurement. Capture polling is intentionally recorded (not presented as exact key/frame timestamps).
const usage = {
  input: 8192,
  output: 512,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 8704,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const quantile = (xs: number[], q: number) =>
  xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.max(0, Math.ceil(xs.length * q) - 1))];

test("installed/candidate CLI PTY key echo and loading-frame cadence", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-pty-latency-"));
  const socket = "bruv-latency-" + process.pid;
  const tmux = tmuxRunner(socket, join(home, "tmux.conf"));
  const binary = resolve(process.env.BRUV_BIN || resolve(import.meta.dir, "../dist/bruv"));
  const binaryVersion = await run([binary, "--version"]);
  expect(binaryVersion.code).toBe(0);
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(binary).stream()) hasher.update(chunk);
  const binarySha256 = hasher.digest("hex");
  let requestCount = 0;
  let heldRequestCount = 0;
  const responses = new Set<import("node:http").ServerResponse>();
  const requestPaths: string[] = [];
  const server = createServer(async (req, res) => {
    requestCount++;
    requestPaths.push(req.url || "");
    for await (const _ of req) {
      /* consume request */
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // Hold until the harness releases it, not a timer that can expire during a slow run.
    res.flushHeaders();
    responses.add(res);
    heldRequestCount++;
    res.on("close", () => responses.delete(res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));

  const runs: any[] = [];
  const artifacts = resolve(import.meta.dir, "../artifacts/latency", socket + "-" + Date.now());
  const samples = Number(process.env.BRUV_LATENCY_SAMPLES || 12);
  await mkdir(artifacts, { recursive: true });
  try {
    const agentDir = join(home, ".bruv", "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
            api: "openai-completions",
            apiKey: "fixture",
            models: [{ id: "fixture-model", name: "fixture", contextWindow: 10000000, maxTokens: 1000 }],
          },
        },
      }),
    );
    await writeFile(join(home, "tmux.conf"), "set -g extended-keys on\nset -g extended-keys-format csi-u\n");
    for (const size of ["short", "long"]) {
      const manager = SessionManager.create(home, join(home, "sessions"));
      const turns = size === "short" ? 2 : Number(process.env.BRUV_LATENCY_LONG_TURNS || 100);
      for (let turn = 0; turn < turns; turn++) {
        manager.appendMessage({
          role: "user",
          content: `Question ${turn}: summarize the rollout constraints and failure modes. Include a concise recommendation.`,
          timestamp: Date.now(),
        });
        manager.appendMessage({
          role: "assistant",
          content: [
            {
              type: "text",
              text: `## Decision ${turn}\n\nWe should preserve the existing API contract while reducing repeated work. The rollout needs staged validation, observable latency budgets, and a rollback path. Risks include stale caches, concurrent updates, partial failures, and misleading success signals.\n\n### Evidence and tradeoffs\nThe implementation should avoid rescanning unchanged historical records on every animation frame. Keep ownership and invalidation explicit; tests should exercise updates, errors, and pagination rather than just the happy path.\n\n`.repeat(
                4,
              ),
            },
          ],
          api: "openai-completions",
          provider: "openai",
          model: "gpt-4o",
          usage,
          stopReason: "stop",
          timestamp: Date.now(),
        });
        for (let j = 0; j < (size === "short" ? 1 : 5); j++) {
          const id = `saved-${turn}-${j}`;
          manager.appendMessage({
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id,
                name: "execute",
                arguments: { label: `Inspect module ${turn}/${j}`, code: "cat src/ui/task-list.ts" },
              },
            ],
            api: "openai-completions",
            provider: "openai",
            model: "gpt-4o",
            usage,
            stopReason: "toolUse",
            timestamp: Date.now(),
          });
          manager.appendMessage({
            role: "toolResult",
            toolCallId: id,
            toolName: "execute",
            content: [
              {
                type: "text",
                text: `--- source excerpt ${turn}/${j} ---\nfunction updateVisibleRows(state) {\n  const items = state.messages.filter(message => message.visible);\n  return items.map(renderMarkdownAndToolResult).join("\n");\n}\n`.repeat(
                  8,
                ),
              },
            ],
            details: {
              exitCode: 0,
              stdout: "tool output: parsed 184 files; 12 warnings; no changes",
              stderr: "",
              images: [],
            },
            isError: false,
            timestamp: Date.now(),
          });
        }
      }
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "HISTORY_READY_" + size }],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o",
        usage,
        stopReason: "stop",
        timestamp: Date.now(),
      });
      const seedEntries = manager.getEntryCount();
      const seedBytes = (await stat(manager.getSessionFile()!)).size;
      const launchedAt = Date.now();
      const cmd = [
        "env",
        `HOME=${home}`,
        `BRUV_CODING_AGENT_DIR=${join(home, ".bruv", "agent")}`,
        "PI_OFFLINE=0",
        "HERDR_ENV=0",
        binary,
        "--no-approve",
        "--session",
        manager.getSessionFile()!,
        "--provider",
        "fixture",
        "--model",
        "fixture-model",
      ]
        .map(shellQuote)
        .join(" ");
      const created = await tmux("new-session", "-d", "-s", "measure", "-x", "100", "-y", "32", "-c", home, cmd);
      expect(created.code).toBe(0);
      let frame = "";
      for (let i = 0; i < 300; i++) {
        frame = (await capturePane(tmux, "measure")).stdout;
        if (frame.includes("HISTORY_READY_" + size)) break;
        await Bun.sleep(50);
      }
      expect(frame).toContain("HISTORY_READY_" + size);
      const startupMs = Date.now() - launchedAt;
      await Bun.sleep(800); // startup/editor warmup, same for both cases
      const clearDraft = async (token: string) => {
        await tmux("send-keys", "-t", "measure", "C-u");
        for (let poll = 0; poll < 250; poll++) {
          const text = (await capturePane(tmux, "measure")).stdout;
          if (!text.includes(token)) return;
          await Bun.sleep(20);
        }
        throw new Error("Editor did not clear " + token);
      };
      const echo: number[] = [];
      for (let k = 0; k < samples; k++) {
        const token = `ECHO_${size}_${k}`;
        const sent = performance.now();
        await tmux("send-keys", "-t", "measure", "-l", token);
        let echoed = false;
        for (let poll = 0; poll < 250; poll++) {
          frame = (await capturePane(tmux, "measure")).stdout;
          if (frame.includes(token)) {
            echoed = true;
            break;
          }
          await Bun.sleep(20);
        }
        expect(echoed, `input token ${token} must appear in terminal echo`).toBe(true);
        echo.push(performance.now() - sent);
        await clearDraft(token);
        await Bun.sleep(100);
      }
      // Submit a request and sample actual tmux terminal frames during the held provider response.
      // Measure echo while generation is held, not just on an idle editor.
      const priorRequests = requestCount;
      await tmux("send-keys", "-t", "measure", "-l", "latency probe");
      await tmux("send-keys", "-t", "measure", "Enter");
      // Request preparation is not the input-echo budget. Large fixtures need time to serialize.
      const requestDeadline = Date.now() + 30000;
      while (heldRequestCount === priorRequests && Date.now() < requestDeadline) await Bun.sleep(20);
      expect(requestCount).toBe(priorRequests + 1);
      expect(heldRequestCount).toBe(priorRequests + 1);
      const echoDuring: number[] = [];
      for (let k = 0; k < samples; k++) {
        const token = `HELD_${size}_${k}`;
        const sent = performance.now();
        await tmux("send-keys", "-t", "measure", "-l", token);
        let echoed = false;
        for (let poll = 0; poll < 250; poll++) {
          frame = (await capturePane(tmux, "measure")).stdout;
          if (frame.includes(token)) {
            echoed = true;
            break;
          }
          await Bun.sleep(20);
        }
        expect(echoed, `held input ${token} must echo`).toBe(true);
        echoDuring.push(performance.now() - sent);
        if (k === samples - 1) await writeFile(join(artifacts, size + "-held-echo.txt"), frame);
        await clearDraft(token);
      }
      // Spinner cadence: compare spinner-only row signatures, not arbitrary changed terminal frames.
      const spinnerGlyphs = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
      const loadingStart = performance.now();
      const spinnerSamples: number[] = [];
      let priorSpinner = "",
        spinnerGaps: number[] = [];
      let lastSpinnerAt = loadingStart;
      const observationMs = 5000,
        pollMs = 50;
      while (performance.now() - loadingStart < observationMs) {
        const frameAt = performance.now();
        frame = (await capturePane(tmux, "measure")).stdout;
        const rows = frame.split("\n");
        const row = rows.find((line) => [...line].some((ch) => "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".includes(ch)));
        if (row) {
          const signature = [...row].find((ch) => spinnerGlyphs.includes(ch));
          if (signature && signature !== priorSpinner) {
            if (priorSpinner) spinnerGaps.push(frameAt - lastSpinnerAt);
            spinnerSamples.push(frameAt - loadingStart);
            priorSpinner = signature;
            lastSpinnerAt = frameAt;
          }
        }
        await Bun.sleep(pollMs);
      }
      expect(spinnerSamples.length).toBeGreaterThan(2);
      runs.push({
        size,
        turns: size === "short" ? 2 : Number(process.env.BRUV_LATENCY_LONG_TURNS || 100),
        seedEntries,
        seedBytes,
        elapsedStartupMs: startupMs,
        echoMs: echo,
        echoP50Ms: quantile(echo, 0.5),
        echoP95Ms: quantile(echo, 0.95),
        echoDuringHeldMs: echoDuring,
        heldEchoP50Ms: quantile(echoDuring, 0.5),
        heldEchoP95Ms: quantile(echoDuring, 0.95),
        capturePollMs: pollMs,
        observationMs: observationMs,
        spinnerTransitions: spinnerGaps.length,
        spinnerCadenceP50Ms: quantile(spinnerGaps, 0.5),
        spinnerCadenceP95Ms: quantile(spinnerGaps, 0.95),
        echoPollSleepMs: 20,
      });
      await writeFile(join(artifacts, size + "-spinner.txt"), frame);
      for (const response of responses)
        response.end(
          'data: {"choices":[{"delta":{"content":"controlled response"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
      await tmux("kill-session", "-t", "measure");
    }
    expect(requestCount).toBe(2);
    expect(requestPaths.every((path) => path === "/v1/chat/completions")).toBe(true);
    const budgets = {
      echoP95Ms: process.env.BRUV_LATENCY_MAX_ECHO_P95_MS
        ? Number(process.env.BRUV_LATENCY_MAX_ECHO_P95_MS)
        : undefined,
      spinnerGapP95Ms: process.env.BRUV_LATENCY_MAX_SPINNER_GAP_P95_MS
        ? Number(process.env.BRUV_LATENCY_MAX_SPINNER_GAP_P95_MS)
        : undefined,
      spinnerTransitions: process.env.BRUV_LATENCY_MIN_SPINNER_TRANSITIONS
        ? Number(process.env.BRUV_LATENCY_MIN_SPINNER_TRANSITIONS)
        : undefined,
    };
    const evidence = {
      binary,
      binaryVersion: binaryVersion.stdout.trim(),
      binarySha256,
      artifacts,
      samples,
      controlledProviderRequests: requestCount,
      controlledProviderPaths: requestPaths,
      providerHold: "until measurements finish",
      budgets,
      results: runs,
    };
    const json = JSON.stringify(evidence, null, 2);
    await writeFile(join(artifacts, "measurements.json"), json);
    if (process.env.BRUV_LATENCY_OUTPUT) await writeFile(process.env.BRUV_LATENCY_OUTPUT, json);
    console.log(json);
    // A diagnostic run may omit budgets. Acceptance runs must supply them explicitly;
    // normal CI load should not silently turn machine timings into flaky assertions.
    for (const result of runs) {
      if (budgets.echoP95Ms !== undefined) {
        expect(result.echoP95Ms, result.size + " idle echo budget").toBeLessThanOrEqual(budgets.echoP95Ms);
        expect(result.heldEchoP95Ms, result.size + " held-response echo budget").toBeLessThanOrEqual(budgets.echoP95Ms);
      }
      if (budgets.spinnerGapP95Ms !== undefined)
        expect(result.spinnerCadenceP95Ms, result.size + " spinner gap budget").toBeLessThanOrEqual(
          budgets.spinnerGapP95Ms,
        );
      if (budgets.spinnerTransitions !== undefined)
        expect(result.spinnerTransitions, result.size + " spinner transition budget").toBeGreaterThanOrEqual(
          budgets.spinnerTransitions,
        );
    }
  } catch (error) {
    const failureFrame = await capturePane(tmux, "measure");
    await writeFile(join(artifacts, "failure-frame.txt"), failureFrame.stdout);
    await writeFile(join(artifacts, "failure.json"), JSON.stringify({error:String(error), requestCount, heldRequestCount, results:runs}, null, 2));
    console.error("Latency failure artifacts:", artifacts);
    throw error;
  } finally {
    await tmux("kill-server");
    server.closeAllConnections();
    server.close();
    await rm(home, { recursive: true, force: true });
  }
}, 180000);
