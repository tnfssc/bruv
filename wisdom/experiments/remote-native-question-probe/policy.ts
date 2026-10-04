import { isDeepStrictEqual } from "node:util";
export function allowedAnswer(input: unknown, question: { id: string; status: string } | undefined, alreadySent: boolean): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "choice,id") return false;
  return !!question && value.id === question.id && value.choice === "A" &&
    (question.status === "answered" || (question.status === "pending" && !alreadySent));
}

// Only the integrated experience endpoint requires a pinned owner/epoch and native ledger revision.
export function allowedScopedAnswer(input: unknown, question: {id:string;status:string;owner?:unknown;version?:number}|undefined, alreadySent:boolean, identity:string, epoch:number):boolean {
 if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
 const value=input as Record<string,unknown>;
 if (Object.keys(value).sort().join(',') !== 'choice,epoch,id,identity,owner,version' || value.identity!==identity || value.epoch!==epoch || !question ||
     !isDeepStrictEqual(value.owner, question.owner) || value.version!==question.version) return false;
 return allowedAnswer({id:value.id,choice:value.choice},question,alreadySent);
}
