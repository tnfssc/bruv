/** The composer asks the conversation to jump to the end after the user sends. */
export const toEnd = () => dispatchEvent(new Event("bruv:end"));
export const onEnd = (listener: () => void) => {
  addEventListener("bruv:end", listener);
  return () => removeEventListener("bruv:end", listener);
};
