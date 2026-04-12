import { Buffer } from "buffer";
import { StrictMode } from "react";

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
