import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { ImageContent } from "@earendil-works/pi-ai";
import { inspectDiagnostics, recordDiagnostic } from "../diagnostics";
import { BoundedOutputBuffer } from "../output-buffer";
import { scrubT3BridgeEnvironment } from "../delegation-environment";
import { decodeImageChannel, IMAGE_CHANNEL_ENV, MAX_IMAGE_CHANNEL_BYTES } from "./images";
import { JOB_BRIDGE_ENV, openParentJobBridge, serveJobBridge } from "./job-bridge";
import {
  type CapturedOutput,
  DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT,
  ExecuteOutputCapture,
  type OutputArtifactErrors,
} from "./output-capture";
import { INTERNAL_TYPESCRIPT_RUNNER_ARG } from "./runner";

export const EXECUTION_DIAGNOSTIC_CODES = ["process_exit", "timeout", "caller_aborted", "shutdown"] as const;

export type ExecutionDiagnosticCode = (typeof EXECUTION_DIAGNOSTIC_CODES)[number];

export interface ExecutionResult {
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  stdoutLost: boolean;
  stderrLost: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  outputArtifactErrors?: OutputArtifactErrors;
  outputBytes?: number;
  capturedOutputBytes?: number;
  outputByteLimit?: number;
  outputTruncated?: boolean;
  stdoutBytes?: number;
  stderrBytes?: number;
  stdoutCapturedBytes?: number;
  stderrCapturedBytes?: number;
  timedOut: boolean;
  cancelled: boolean;
  termination?: {
    cause: "timeout" | "execute-abort" | "session-shutdown";
    requestedAt: string;
  };
  images: ImageContent[];
  imageResizeNotes?: string[];
  imageError?: string;
}

function signalProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process or its group may already have exited.
  }
}

// Own the first termination request and the listener/timers that can issue it.
// Watching starts only after the caller has installed child completion handlers.
function executionCancellation(
  child: ReturnType<typeof spawn>,
  callerSignal: AbortSignal | undefined,
  killGraceMs: number,
) {
  const controller = new AbortController();
  let termination: ExecutionResult["termination"];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const terminate = (cause: NonNullable<ExecutionResult["termination"]>["cause"]) => {
    // A caller abort racing a timeout cannot rewrite an established cause.
    if (termination) return;
    termination = { cause, requestedAt: new Date().toISOString() };
    controller.abort(cause === "timeout" ? "timeout" : callerSignal?.reason);
    signalProcessGroup(child, "SIGTERM");
    killTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), killGraceMs);
    killTimer.unref?.();
  };
  const onAbort = () => terminate(callerSignal?.reason === "shutdown" ? "session-shutdown" : "execute-abort");

  return {
    signal: controller.signal,
    get termination() {
      return termination;
    },
    watch(timeoutMs: number | undefined) {
      callerSignal?.addEventListener("abort", onAbort, { once: true });
      if (callerSignal?.aborted) onAbort();
      if (timeoutMs) {
        timeout = setTimeout(() => terminate("timeout"), timeoutMs);
        timeout.unref?.();
      }
    },
    close() {
      controller.abort();
      callerSignal?.removeEventListener("abort", onAbort);
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    },
  };
}

export async function executeIsolated(
  code: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  options: {
    executablePath?: string;
    killGraceMs?: number;
    jobHandler?: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
    /** Keep the outer execute tool-call ID stable when its invocation is replayed. */
    executeInvocationId?: string;
    sessionFile?: string;
    /** Cap the combined complete stdout and stderr capture. */
    outputByteLimit?: number;
  } = {},
): Promise<ExecutionResult> {
  if (
    options.outputByteLimit !== undefined &&
    (!Number.isSafeInteger(options.outputByteLimit) || options.outputByteLimit < 0)
  )
    throw new RangeError("outputByteLimit must be a non-negative safe integer");
  if (signal?.aborted) {
    const result: ExecutionResult = {
      stdout: "",
      stderr: "",
      stdoutLost: false,
      stderrLost: false,
      outputBytes: 0,
      capturedOutputBytes: 0,
      outputByteLimit: options.outputByteLimit ?? DEFAULT_EXECUTE_OUTPUT_BYTE_LIMIT,
      outputTruncated: false,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutCapturedBytes: 0,
      stderrCapturedBytes: 0,
      timedOut: false,
      cancelled: true,
      termination: {
        cause: signal.reason === "shutdown" ? "session-shutdown" : "execute-abort",
        requestedAt: new Date().toISOString(),
      },
      images: [],
      imageResizeNotes: [],
    };
    recordDiagnostic(result, {
      component: "jobs",
      code: signal.reason === "shutdown" ? "shutdown" : "caller_aborted",
      outcome: "cancelled",
      cancellation: signal.reason === "shutdown" ? "shutdown" : "caller",
      dispatch: "none",
    });
    return result;
  }
  const childEnv: NodeJS.ProcessEnv = {
    ...scrubT3BridgeEnvironment(process.env),
    [IMAGE_CHANNEL_ENV]: "1",
  };
  if (options.jobHandler) childEnv[JOB_BRIDGE_ENV] = "1";
  else delete childEnv[JOB_BRIDGE_ENV];
  const child = spawn(options.executablePath ?? process.execPath, [INTERNAL_TYPESCRIPT_RUNNER_ARG], {
    cwd,
    env: childEnv,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe", "pipe", ...(options.jobHandler ? ["ipc" as const] : [])],
  });
  const output = new ExecuteOutputCapture({
    sessionFile: options.sessionFile,
    outputByteLimit: options.outputByteLimit,
  });
  const imageOutput = new BoundedOutputBuffer(MAX_IMAGE_CHANNEL_BYTES);
  const imagePipe = child.stdio[3] as Readable | undefined;
  const jobPipe = options.jobHandler ? openParentJobBridge(child) : undefined;
  const cancellation = executionCancellation(child, signal, options.killGraceMs ?? 5_000);
  const bridgeDiagnosticOwner = {};
  const jobBridge =
    options.jobHandler && jobPipe
      ? serveJobBridge(
          jobPipe,
          options.jobHandler,
          cancellation.signal,
          bridgeDiagnosticOwner,
          options.executeInvocationId,
        )
      : undefined;
  let imageError: string | undefined;
  // Install completion handlers before writing source or acting on cancellation.
  const completion = new Promise<{
    exitCode: number | null;
    exitSignal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => {
      // execute is synchronous work, not a background-task launcher. Reap any
      // remaining group members even if the leader exited successfully or its
      // descendants closed their stdio. Otherwise close can hang indefinitely.
      signalProcessGroup(child, "SIGKILL");
    });
    child.once("close", (exitCode, exitSignal) => resolve({ exitCode, exitSignal }));
  });
  imagePipe?.on("data", (chunk: Buffer) => {
    if (imageError) return;
    imageOutput.append(chunk);
    if (imageOutput.baseOffset > 0) {
      imageError = "Image output channel exceeded its byte limit";
      signalProcessGroup(child, "SIGKILL");
    }
  });
  imagePipe?.on("error", () => {
    imageError = "Could not read image output channel";
    signalProcessGroup(child, "SIGKILL");
  });
  const outputPumps = Promise.allSettled([
    output.consume("stdout", child.stdout!),
    output.consume("stderr", child.stderr!),
  ]);
  child.stdin!.on("error", () => {
    // Early exits (including EPIPE while sending source) are reported by status.
  });
  cancellation.watch(timeoutMs);
  child.stdin!.end(code);

  let completed: { exitCode: number | null; exitSignal: NodeJS.Signals | null } | undefined;
  let captured: CapturedOutput | undefined;
  try {
    completed = await completion;
    // Wait for both streams even if one pump rejects, so no writer can race
    // artifact finalization. The capture records pump failures as metadata.
    await outputPumps;
  } finally {
    // Commit response ACKs only at clean worker completion. Until this point a
    // received ACK is provisional and bridge teardown restores notification
    // ownership for any foreground task results.
    jobBridge?.close(completed?.exitCode === 0 && !cancellation.termination);
    cancellation.close();
    child.stdin!.destroy();
    child.stdout!.destroy();
    child.stderr!.destroy();
    imagePipe?.destroy();
    jobPipe?.destroy();
    await outputPumps;
    // Always close output artifacts, including exceptional stream-pump paths.
    captured = await output.result();
  }
  if (!completed || !captured) throw new Error("Execution ended without a result");
  const { exitCode, exitSignal } = completed;
  const termination = cancellation.termination;
  const timedOut = termination?.cause === "timeout";
  const cancelled = termination !== undefined && !timedOut;

  let images: ImageContent[] = [];
  const imageResizeNotes: string[] = [];
  // Images are atomic results: never attach partial output from failed,
  // cancelled, timed-out, or malformed executions.
  if (exitCode === 0 && !timedOut && !cancelled && !imageError) {
    try {
      const decodedImages = decodeImageChannel(imageOutput.read(0, MAX_IMAGE_CHANNEL_BYTES).buffer);
      images = decodedImages.map(({ resize, ...image }, index) => {
        if (resize) {
          const scale = resize.originalWidth / resize.width;
          imageResizeNotes.push(
            `[Image ${index + 1}: original ${resize.originalWidth}x${resize.originalHeight}, displayed at ${resize.width}x${resize.height}. Multiply coordinates by ${scale.toFixed(2)} to map to the original image.]`,
          );
        }
        return image;
      });
    } catch (error) {
      imageError = error instanceof Error ? error.message : "Invalid image output";
    }
  }
  const result: ExecutionResult = {
    exitCode: exitCode ?? undefined,
    signal: exitSignal ?? undefined,
    ...captured,
    timedOut,
    cancelled,
    ...(termination ? { termination } : {}),
    images,
    imageResizeNotes,
    imageError,
  };
  const diagnostic = timedOut
    ? {
        code: "timeout" as const,
        outcome: "cancelled" as const,
        cancellation: "timeout" as const,
      }
    : cancelled
      ? {
          code: termination?.cause === "session-shutdown" ? ("shutdown" as const) : ("caller_aborted" as const),
          outcome: "cancelled" as const,
          cancellation: termination?.cause === "session-shutdown" ? ("shutdown" as const) : ("caller" as const),
        }
      : exitCode === 0 && !imageError
        ? { code: "process_exit" as const, outcome: "success" as const }
        : { code: "process_exit" as const, outcome: "failed" as const };
  for (const record of inspectDiagnostics(bridgeDiagnosticOwner).records) recordDiagnostic(result, record);
  recordDiagnostic(result, { component: "jobs", ...diagnostic });
  return result;
}

export function formatResult(result: ExecutionResult): string {
  const status = result.cancelled
    ? "cancelled"
    : result.timedOut
      ? "timed out"
      : result.exitCode === 0 && !result.imageError
        ? "completed"
        : "failed";
  const sections = [
    `Execution ${status}${result.exitCode !== undefined ? ` with exit code ${result.exitCode}` : ""}${result.signal ? ` (${result.signal})` : ""}.`,
  ];
  const directoryError = result.outputArtifactErrors?.directory;
  const streamLabel = (name: "stdout" | "stderr") => {
    const lost = result[(name + "Lost") as "stdoutLost" | "stderrLost"];
    const path = result[(name + "Path") as "stdoutPath" | "stderrPath"];
    const error = directoryError ?? result.outputArtifactErrors?.[name];
    const byteTruncated =
      result.outputTruncated === true &&
      (result[(name + "CapturedBytes") as "stdoutCapturedBytes" | "stderrCapturedBytes"] ?? 0) <
        (result[(name + "Bytes") as "stdoutBytes" | "stderrBytes"] ?? 0);
    if (path && (error || byteTruncated))
      return `${name} (${lost ? "truncated preview; " : ""}output file incomplete: ${path})`;
    if (path) return `${name} (${lost ? "truncated preview; complete output" : "complete output also saved"}: ${path})`;
    if (lost && error) return `${name} (truncated preview; full output could not be saved)`;
    return `${name}${lost ? " (truncated preview)" : ""}`;
  };
  if (result.stdout) sections.push(`${streamLabel("stdout")}:\n${result.stdout}`);
  if (result.stderr) sections.push(`${streamLabel("stderr")}:\n${result.stderr}`);
  if (result.outputTruncated)
    sections.push(
      `Output capture limit reached: retained ${result.capturedOutputBytes} of ${result.outputBytes} stdout/stderr bytes (limit ${result.outputByteLimit}).`,
    );
  if (result.outputArtifactErrors) {
    for (const [scope, message] of Object.entries(result.outputArtifactErrors))
      sections.push(`Output artifact error (${scope}): ${message}`);
  }
  if (result.imageError) sections.push(`Image output error: ${result.imageError}`);
  if (result.images.length)
    sections.push(`Returned ${result.images.length} image${result.images.length === 1 ? "" : "s"}.`);
  if (result.imageResizeNotes?.length) sections.push(result.imageResizeNotes.join("\n"));
  if (!result.stdout && !result.stderr && !result.images.length && !result.imageError) sections.push("No output.");
  return sections.join("\n\n");
}
