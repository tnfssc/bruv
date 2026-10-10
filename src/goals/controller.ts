export const REQUIRED_BLOCKED_TURNS = 3;

/** A blocker must recur on separate goal turns; ordinary work needs no keepalive. */
export class GoalContinuationController {
  #blocker?: string;
  #completedTurns = 0;
  #reportedThisRun = false;

  beginRun(): void {
    this.#reportedThisRun = false;
  }

  reportBlocker(blocker: string): boolean {
    if (blocker !== this.#blocker) {
      this.#blocker = blocker;
      this.#completedTurns = 0;
    }
    this.#reportedThisRun = true;
    return this.#completedTurns + 1 >= REQUIRED_BLOCKED_TURNS;
  }

  endRun(): void {
    if (this.#reportedThisRun) this.#completedTurns++;
    else this.reset();
    this.#reportedThisRun = false;
  }

  audit(): { blocker: string; attempts: number; required: number } | undefined {
    if (!this.#blocker) return undefined;
    return {
      blocker: this.#blocker,
      attempts: Math.min(this.#completedTurns + Number(this.#reportedThisRun), REQUIRED_BLOCKED_TURNS),
      required: REQUIRED_BLOCKED_TURNS,
    };
  }

  reset(): void {
    this.#blocker = undefined;
    this.#completedTurns = 0;
    this.#reportedThisRun = false;
  }
}
