import React from "react";

/** Minimal file list with current selection.
 *  In the future we can add upload-from-PC and import-from-Git features here.
 */
export default function FileExplorer({ files, currentFile, setCurrentFile }) {
  return (
    <div style={{ padding: 10, height: "100%", display: "flex", flexDirection: "column" }}>
      <h3>Files</h3>
      <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
        {files.map((f) => (
          <div
            key={f.path}
            onClick={() => setCurrentFile(f.path)}
            style={{
              padding: "8px 10px",
              cursor: "pointer",
              background: f.path === currentFile ? "#eef5ff" : "transparent",
              borderBottom: "1px solid #eee"
            }}
          >
            {f.path}
          </div>
        ))}
      </div>
    </div>
  );
}

