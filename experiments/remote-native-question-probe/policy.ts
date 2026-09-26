export function allowedAnswer(input: unknown, question: { id: string; status: string } | undefined, alreadySent: boolean): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "choice,id") return false;
  return !!question && value.id === question.id && value.choice === "A" &&
    (question.status === "answered" || (question.status === "pending" && !alreadySent));
}
