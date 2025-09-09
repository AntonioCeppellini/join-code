import React from "react";

/** Simple suggestion panel. Only the current editor sees them (enforced in Editor.jsx). */
export default function Suggestions({ suggestions, accept, clear }) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h4 style={{ margin: 0 }}>Suggestions</h4>
        <button onClick={clear}>Clear</button>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {suggestions.length === 0 && <div style={{ color: "#666" }}>No suggestions.</div>}
        {suggestions.map((s, idx) => (
          <div key={idx} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 12, color: "#666" }}>
              from <strong>{s.user}</strong> → <code>{s.path}</code>
            </div>
            <pre style={{ whiteSpace: "pre-wrap" }}>{s.value}</pre>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => accept(s)}>Accept</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

