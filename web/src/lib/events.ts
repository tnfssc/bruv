/** The composer asks the conversation to jump to the end after the user sends. */
export const toEnd = () => dispatchEvent(new Event("bruv:end"));
export const onEnd = (listener: () => void) => {
  addEventListener("bruv:end", listener);
  return () => removeEventListener("bruv:end", listener);
};

/** The user asked the assistant about something from the activity panel: a phone closes the panel to show the answer. */
export const toAsked = () => dispatchEvent(new Event("bruv:asked"));
export const onAsked = (listener: () => void) => {
  addEventListener("bruv:asked", listener);
  return () => removeEventListener("bruv:asked", listener);
};
