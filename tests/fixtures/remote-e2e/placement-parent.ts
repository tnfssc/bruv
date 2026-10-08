/** Pure fake-parent response shared by the three migrated runners. */
export type Message = { role: string; tool_call_id?: string; content?: unknown };
export function placementCode(prompt: string, retry = false) {
  const source =
    prompt === "REMOTE_FIXTURE_REPO_SAFE"
      ? retry
        ? 'const previous=JSON.parse(await Bun.file(file).text()); const source={includeUntracked:["on-demand.txt"],retryTaskId:previous.launch.sourceApproval.taskId};'
        : 'const source={includeUntracked:["on-demand.txt"]};'
      : "const source=undefined;";
  return [
    'const discovery=await jobs.targets(); const target=discovery.targets.find(t=>t.name==="fixture-owner" && t.kind==="ssh" && t.authorized); if(!target) throw Error("Missing pinned fixture target");',
    "const file=process.env.HOME+" + JSON.stringify("/placement-" + prompt + ".json") + ";",
    source,
    'const launch=await subagent({target:target.name,type:"normal",prompt:' +
      JSON.stringify(prompt + " REMOTE_FIXTURE_NORMAL_PLACEMENT") +
      ",waitSeconds:0,...(source?{source}:{})});",
    'if(!launch.id?.startsWith("ssh:") || !launch.background) throw Error("Expected stable async SSH job");',
    "await Bun.write(file,JSON.stringify({discovery,launch})); console.log(launch);",
  ].join(" ");
}
export function placementReply(messages: Message[]) {
  const user = messages.filter((m) => m.role === "user").at(-1);
  const text = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
  const prompt = text?.match(/REMOTE_FIXTURE_[A-Za-z_]+/)?.[0];
  if (!prompt) return { role: "assistant", content: "LOCAL_FIXTURE_ACK" };
  const stop = text?.includes("PLACEMENT_STOP") ?? false;
  const retry = text?.includes("PLACEMENT_RETRY") ?? false;
  const callId = stop ? "fixture-placement-stop" : "fixture-placement-" + prompt + (retry ? "-retry" : "");
  if (messages.some((m) => m.role === "tool" && m.tool_call_id === callId))
    return { role: "assistant", content: "LOCAL_FIXTURE_ACK" };
  const code = stop
    ? 'const proof=JSON.parse(await Bun.file(process.env.HOME+"/placement-REMOTE_FIXTURE_CANCEL.json").text()); console.log(await jobs.stop(proof.launch.id));'
    : placementCode(prompt, retry);
  return {
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: callId,
        type: "function",
        function: { name: "execute", arguments: JSON.stringify({ code }) },
      },
    ],
  };
}
