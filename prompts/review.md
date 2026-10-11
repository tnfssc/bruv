Review the chosen diff. Look for real bugs first: wrong results, data loss, security problems, and broken behavior. Read enough surrounding code to check each concern. Follow the project's instructions.

For each finding, give file:line, explain when it breaks and why it matters, and suggest a concrete fix. Put the most serious findings first. Report problems caused by this diff, and say when a concern depends on an assumption.

Then suggest at most a few important simplifications, if they would make the code easier to maintain. Skip style nits and speculative changes. If nothing serious is wrong, say so plainly. Mention any checks you could not run.

Don't change files unless the user asks.
