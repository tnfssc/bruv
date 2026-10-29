import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};
const plugins = [remarkGfm];

/** Markdown to React elements. Raw HTML in the text is shown as text, never run. */
export const render = (text: string) => Markdown({ children: text, remarkPlugins: plugins, components });
