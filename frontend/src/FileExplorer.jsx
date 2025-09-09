import React, { useRef } from "react";

/** Minimal file list with creation and upload from local PC.
 *  - "New file" prompts for a path (e.g., src/app.py, index.js)
 *  - "Upload" accepts multiple files; reads text content and broadcasts each.
 *  Backend should handle 'file_create' to persist snapshot and fan out.
 */
export default function FileExplorer({
  files,
  setFiles,
  currentFile,
  setCurrentFile,
  send,
  wsReady,
}) {
  const inputRef = useRef(null);

  const createFile = () => {
    const path = prompt("Enter new file name (e.g. main.py, src/app.js):", "new_file.txt");
    if (!path) return;
    if (files.some((f) => f.path === path)) {
      alert("File already exists.");
      return;
    }
    const newFile = { path, content: "" };
    setFiles((prev) => [...prev, newFile]);
    setCurrentFile(path);
    send({ type: "file_create", path, content: "" });
  };

  const onUpload = async (e) => {
    const list = Array.from(e.target.files || []);
    for (const file of list) {
      try {
        const text = await file.text();
        const path = file.webkitRelativePath || file.name;
        // If exists, replace; otherwise append
        setFiles((prev) => {
          const has = prev.some((f) => f.path === path);
          return has
            ? prev.map((f) => (f.path === path ? { ...f, content: text } : f))
            : [...prev, { path, content: text }];
        });
        send({ type: "file_create", path, content: text });
      } catch (err) {
        console.error("Upload failed for", file.name, err);
      }
    }
    e.target.value = "";
  };

  return (
    <div style={{ padding: 10, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button onClick={createFile} disabled={!wsReady}>New file</button>
        <button onClick={() => inputRef.current?.click()} disabled={!wsReady}>Upload</button>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={onUpload}
        />
      </div>

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
            title={f.path}
          >
            {f.path}
          </div>
        ))}
      </div>
    </div>
  );
}

