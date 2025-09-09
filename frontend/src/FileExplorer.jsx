import React, { useRef } from "react";

export default function FileExplorer({
  files,
  setFiles,
  currentFile,
  setCurrentFile,
  send,
  wsReady,
  isEditor,
}) {
  const fileInputRef = useRef(null);
  const dirInputRef = useRef(null);

  const createFile = () => {
    const path = prompt("Enter new file name (e.g. main.py, src/app.js):", "new_file.txt");
    if (!path) return;
    if (files.some((f) => f.path === path)) {
      alert("File already exists.");
      return;
    }
    setFiles((prev) => [...prev, { path, content: "" }]);
    setCurrentFile(path);
    send({ type: "file_create", path, content: "" });
  };

  const uploadList = async (fileList) => {
    const list = Array.from(fileList || []);
    for (const file of list) {
      try {
        const text = await file.text();
        const path = file.webkitRelativePath || file.name;
        setFiles((prev) => {
          const has = prev.some((f) => f.path === path);
          return has
            ? prev.map((f) => (f.path === path ? { ...f, content: text } : f))
            : [...prev, { path, content: text }];
        });
        send({ type: "file_create", path, content: text });
      } catch (e) {
        console.error("Upload failed for", file.name, e);
      }
    }
  };

  const onUploadFiles = (e) => { uploadList(e.target.files); e.target.value = ""; };
  const onUploadFolder = (e) => { uploadList(e.target.files); e.target.value = ""; };

  return (
    <div style={{ padding: 10, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* toolbar ONLY if there are files and user is editor */}
      {isEditor && files.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button onClick={() => fileInputRef.current?.click()} disabled={!wsReady}>Upload files</button>
          <button onClick={() => dirInputRef.current?.click()} disabled={!wsReady}>Upload folder</button>
          <button onClick={createFile} disabled={!wsReady}>Create</button>

          <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onUploadFiles} />
          <input ref={dirInputRef} type="file" multiple webkitdirectory="true" directory="true" style={{ display: "none" }} onChange={onUploadFolder} />
        </div>
      )}

      <h3>Files</h3>
      {files.length === 0 ? (
        <div style={{ padding: 8, color: "#666", border: "1px dashed #ccc", borderRadius: 6 }}>
          No files yet.
        </div>
      ) : (
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
      )}
    </div>
  );
}

