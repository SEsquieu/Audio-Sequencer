import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SongProvider } from "./state/songContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SongProvider>
      <App />
    </SongProvider>
  </React.StrictMode>
);
