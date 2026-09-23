"use client";

/**
 * The layout itself failed.
 *
 * This replaces the whole document — html and body included — so it can rely on
 * nothing: not the fonts, not globals.css, not a single component. Everything
 * here is inline for that reason. It should essentially never be seen, which is
 * exactly why it must not be the thing that also breaks.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf6f4",
          color: "#2b1610",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 44 }}>⚠️</div>
          <h1 style={{ margin: "14px 0 6px", fontSize: 22, fontWeight: 700 }}>MinTech could not start</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#6b6a66" }}>
            The app failed before it could draw anything. Reloading usually clears it. No submitted report is
            affected by this.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 999,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              background: "#a63d25",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: 22, fontSize: 10, fontFamily: "monospace", color: "#a8a29e" }}>
              ref {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
