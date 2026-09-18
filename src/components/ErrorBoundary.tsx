import React from "react";
import pkg from "../../package.json";

const LOG_HINT = "Backend log: %APPDATA%\\dev.revela.app\\revela.log";

function buildReport(detail: string): string {
  return [
    `Revela v${pkg.version} crash report`,
    `time: ${new Date().toISOString()}`,
    `webview: ${navigator.userAgent}`,
    "",
    detail,
    "",
    LOG_HINT,
  ].join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

interface Toast {
  id: number;
  msg: string;
}

interface State {
  fatal: string | null;
  toasts: Toast[];
  copied: boolean;
}

let toastSeq = 0;

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { fatal: null, toasts: [], copied: false };

  static getDerivedStateFromError(err: unknown): Partial<State> {
    const e = err as Error | undefined;
    return { fatal: e?.stack || String(err) };
  }

  componentDidCatch(_err: unknown, info: React.ErrorInfo) {
    if (info.componentStack) {
      this.setState((s) => ({
        fatal: (s.fatal ?? "") + "\n\ncomponent stack:" + info.componentStack,
      }));
    }
  }

  private onWindowError = (e: ErrorEvent) => {
    this.pushToast(`Error: ${e.message}`);
  };

  private onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | string | undefined;
    this.pushToast(`Operation failed: ${typeof r === "object" && r?.message ? r.message : String(r)}`);
  };

  componentDidMount() {
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onRejection);
  }

  private pushToast(msg: string) {
    const id = ++toastSeq;
    this.setState((s) => ({ toasts: [...s.toasts.slice(-4), { id, msg }] }));
    setTimeout(() => this.dismiss(id), 10000);
  }

  private dismiss(id: number) {
    this.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }

  render() {
    if (this.state.fatal !== null) {
      const report = buildReport(this.state.fatal);
      return (
        <div className="crash">
          <h1>Revela crashed</h1>
          <p>
            Sorry — something went wrong. Press <b>Copy report</b> and paste it into a
            GitHub issue, together with what you were doing.
          </p>
          <pre className="crash-detail">{report}</pre>
          <div className="crash-actions">
            <button
              className="btn primary"
              onClick={() =>
                void copyText(report).then((ok) => this.setState({ copied: ok }))
              }
            >
              {this.state.copied ? "Copied ✓" : "Copy report"}
            </button>
            <button className="btn" onClick={() => location.reload()}>
              Restart
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        {this.props.children}
        {this.state.toasts.length > 0 && (
          <div className="toasts">
            {this.state.toasts.map((t) => (
              <div key={t.id} className="toast">
                <span className="toast-msg">{t.msg}</span>
                <button className="toast-close" onClick={() => this.dismiss(t.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
}
