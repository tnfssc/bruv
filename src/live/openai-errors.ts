/** Only classify explicit provider codes; never expose raw provider messages or infer account eligibility. */
export function providerFailure(error: unknown, model: string, fallback: string): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case "insufficient_quota":
      return (
        "OpenAI reports insufficient quota for " + model + ". Check API billing and limits; no model was substituted."
      );
    case "rate_limit_exceeded":
      return "OpenAI reports a rate limit for " + model + ". Retry later; no model was substituted.";
    case "model_not_found":
      return "OpenAI reports " + model + " unavailable or inaccessible to this API key; no model was substituted.";
    case "invalid_api_key":
      return "OpenAI rejected the API key for " + model + ". Use /login to configure an OpenAI API key.";
    default:
      return fallback;
  }
}

/** Realtime error data is untrusted: only these protocol identifiers and structural paths are printable. */
const SAFE_PROVIDER_CODES = new Set([
  "invalid_request_error",
  "invalid_value",
  "invalid_type",
  "missing_required_parameter",
  "unknown_parameter",
  "unsupported_value",
  "unsupported_parameter",
  "invalid_enum_value",
  "invalid_model",
  "invalid_audio_format",
  "invalid_audio",
  "invalid_tool",
  "invalid_function_call",
  "authentication_error",
  "permission_denied",
  "server_error",
  "api_error",
  "rate_limit_exceeded",
  "insufficient_quota",
  "model_not_found",
  "invalid_api_key",
]);
const SAFE_PROVIDER_TYPES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "rate_limit_error",
  "api_error",
  "server_error",
  "invalid_request",
  "validation_error",
]);
const SAFE_FIELDS = new Set([
  "session",
  "session.type",
  "session.model",
  "session.instructions",
  "session.voice",
  "session.modalities",
  "session.output_modalities",
  "session.turn_detection",
  "session.turn_detection.type",
  "session.turn_detection.threshold",
  "session.turn_detection.prefix_padding_ms",
  "session.turn_detection.silence_duration_ms",
  "session.input_audio_format",
  "session.output_audio_format",
  "session.input_audio_transcription",
  "session.input_audio_transcription.model",
  "session.audio",
  "session.audio.input",
  "session.audio.output",
  "session.audio.input.format",
  "session.audio.input.format.type",
  "session.audio.input.format.rate",
  "session.audio.input.transcription",
  "session.audio.input.transcription.model",
  "session.audio.input.turn_detection",
  "session.audio.input.turn_detection.type",
  "session.audio.input.turn_detection.create_response",
  "session.audio.input.turn_detection.interrupt_response",
  "session.audio.input.turn_detection.threshold",
  "session.audio.input.turn_detection.prefix_padding_ms",
  "session.audio.input.turn_detection.silence_duration_ms",
  "session.audio.output.format",
  "session.audio.output.format.type",
  "session.audio.output.format.rate",
  "session.audio.output.voice",
  "session.tools",
  "session.tool_choice",
  "tools",
  "tool_choice",
]);
const SAFE_TOOL_FIELDS = new Set([
  "",
  ".type",
  ".name",
  ".description",
  ".parameters",
  ".parameters.type",
  ".parameters.properties",
  ".parameters.required",
  ".strict",
]);
function safeProviderField(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 100) return;
  if (SAFE_FIELDS.has(value)) return value;
  const normalized = value.replace(/\.(0|[1-9]\d{0,2})(?=\.|$)/g, "[$1]");
  // Array indexes are structural; names of properties/keys inside tool schemas are not.
  const match = /^(session\.)?tools\[(0|[1-9]\d{0,2})\](.*)$/.exec(normalized);
  if (match && SAFE_TOOL_FIELDS.has(match[3])) return normalized;
}
export function voiceProviderFailure(error: unknown, model: string, fallback: string): string {
  const friendly = providerFailure(error, model, fallback);
  if (!error || typeof error !== "object") return friendly;
  const e = error as { code?: unknown; type?: unknown; param?: unknown };
  const field = safeProviderField(e.param);
  const details = [
    typeof e.code === "string" && SAFE_PROVIDER_CODES.has(e.code) ? "code " + e.code : undefined,
    typeof e.type === "string" && SAFE_PROVIDER_TYPES.has(e.type) ? "type " + e.type : undefined,
    field ? "field " + field : undefined,
  ].filter(Boolean);
  return details.length ? friendly + " (" + details.join(", ") + ")" : friendly;
}
