// Read-only bounded source-function probe; run with bun. No SDK subprocess/provider call.
import { readFileSync } from 'node:fs';
const path = process.argv[2] ?? '.cache/acp-t3-upstream-experience/source-nightly/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts';
const source = readFileSync(path, 'utf8');
const names = ['isClaudeOpaqueBackgroundTaskType', 'claudePendingBackgroundTask', 'claudeTaskTypeFromSdkMessage', 'isClaudeNonSubagentTask', 'parseClaudeBackgroundTaskEntry'];
const functions = names.map(name => { const start = source.indexOf(`function ${name}(`); if (start < 0) throw Error(`Missing ${name}`); const end = source.indexOf('\nfunction ', start + 1); if (end < 0) throw Error('Missing boundary'); return source.slice(start, end); });
const js = new Bun.Transpiler({loader:'ts'}).transformSync(`const CLAUDE_OPAQUE_BACKGROUND_TASK_KINDS = new Map([["local_bash", "command"]]);\n${functions.join('\n')}`);
const h = new Function(`${js}\nreturn {isClaudeNonSubagentTask,parseClaudeBackgroundTaskEntry}`)();
console.log(JSON.stringify({revision:'fed41fa88bb27cb4325cb208d571393850bc63c2',classification:Object.fromEntries(['local_bash','local_agent','mcp_task','local_workflow','unknown'].map(task_type=>[task_type,h.isClaudeNonSubagentTask({type:'system',subtype:'task_started',task_type})])),rosters:[h.parseClaudeBackgroundTaskEntry({task_id:'shell-1',task_type:'local_bash',description:'real shell'},new Map()),h.parseClaudeBackgroundTaskEntry({task_id:'shell-1',task_type:'local_bash',description:'real watcher'},new Map([['shell-1',{}]])),h.parseClaudeBackgroundTaskEntry({task_id:'agent-1',task_type:'local_agent'},new Map())]},null,2));
