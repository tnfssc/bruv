import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { loadMarkdown } from "./lib/markdown";
import { apply } from "./state/feed";
import { connect } from "./state/socket";

connect(apply);
loadMarkdown();
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
