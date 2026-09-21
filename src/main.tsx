import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import ViewerWindow from "./components/ViewerWindow";
import "./styles.css";

const isViewer = window.location.hash === "#viewer";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>{isViewer ? <ViewerWindow /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
