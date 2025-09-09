import React, { useEffect, useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import Suggestions from "./Suggestions.jsx";

export default function CodeEditor({
  roomId,
  user,
  socket,
  send,
  wsReady,
  files,
  currentFile,
  setFiles,
  setCurrentFile,
  onEditorChange,
}) {
  const [editor, setEditor] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [requests, setRequests] = useState([]);
  const initialisedRef = useRef(false);

  // inputs for central hero actions
  const fileInputRef = useRef(null);
  const dirInputRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "ready") {
        setEditor(data.editor || null);
        onEditorChange?.(data.editor || null);

        if (data.files && typeof data.files === "object" && !initialisedRef.current) {
          const list = Object.entries(data.files).map(([path, content]) => ({ path, content }));
          setFiles(list);
          if (list.length > 0) setCurrentFile(list[0].path);
          initialisedRef.current = true;
        }
        return;
      }

      if (data.type === "turn_update") {
        setEditor(data.editor);
        onEditorChange?.(data.editor);
        setRequests((prev) => prev.filter((u) => u !== data.editor));
        return;
      }

      if (data.type === "request_turn") {
        if (user.username === editor && !requests.includes(data.user)) {
          setRequests((prev) => [...prev, data.user]);
        }
        return;
      }

      if (data.type === "deny_turn" && data.user === user.username) {
        alert("Your request to take the editor role has been denied.");
        return;
      }

      if (data.type === "code" && data.path) {
        setFiles((prev) =>
          prev.map((f) => (f.path === data.path ? { ...f, content: data.value } : f))
        );
        return;
      }

      if (data.type === "file_create" && data.path) {
        setFiles((prev) => {
          const exists = prev.some((f) => f.path === data.path);
          const next = exists
            ? prev.map((f) => (f.path === data.path ? { ...f, content: data.content ?? "" } : f))
            : [...prev, { path: data.path, content: data.content ?? "" }];
          // if it was the first file ever, select it
          if (prev.length === 0 && next.length > 0) setCurrentFile(next[0].path);
          return next;
        });
        return;
      }

      if (data.type === "suggestion" && editor === user.username) {
        setSuggestions((prev) => [...prev, data]);
        return;
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket, editor, user?.username, setFiles, setCurrentFile, requests, onEditorChange]);

  const isEditor = editor === user.username;

  // --- central hero actions (only when files.length === 0 && isEditor) ---
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

  const uploadList = async (fileList) => {
    const list = Array.from(fileList || []);
    let firstNewPath = null;

    for (const file of list) {
      try {
        const text = await file.text();
        const path = file.webkitRelativePath || file.name;

        setFiles((prev) => {
          const exists = prev.some((f) => f.path === path);
          const next = exists
            ? prev.map((f) => (f.path === path ? { ...f, content: text } : f))
            : [...prev, { path, content: text }];
          if (!exists && !firstNewPath) firstNewPath = path;
          return next;
        });

        send({ type: "file_create", path, content: text });
      } catch (e) {
        console.error("Upload failed for", file.name, e);
      }
    }

    if (!currentFile) {
      const pick = firstNewPath || (files[0] && files[0].path);
      if (pick) setCurrentFile(pick);
    }
  };

  const onUploadFiles = (e) => { uploadList(e.target.files); e.target.value = ""; };
  const onUploadFolder = (e) => { uploadList(e.target.files); e.target.value = ""; };

  // --- turn-taking + suggestions ---
  const onChange = (value) => {
    if (!isEditor || !currentFile) return;
    setFiles((prev) => prev.map((f) => (f.path === currentFile ? { ...f, content: value } : f)));
    send({ type: "code", path: currentFile, value });
  };

  const requestTurn = () => {
    if (isEditor) return;
    send({ type: "request_turn", user: user.username });
  };
  const approveTurn = (username) => { send({ type: "approve_turn", user: username }); setRequests((p) => p.filter((u) => u !== username)); };
  const denyTurn = (username) => { send({ type: "deny_turn", user: username }); setRequests((p) => p.filter((u) => u !== username)); };

  const proposeChange = () => {
    if (!currentFile) return;
    const file = files.find((f) => f.path === currentFile);
    const content = file ? file.content : "";
    const suggestion = prompt("Enter your suggestion for this file:", content);
    if (suggestion) send({ type: "suggestion", user: user.username, path: currentFile, value: suggestion });
  };

  const fileContent = files.find((f) => f.path === currentFile)?.content ?? "";

  // If no files yet → central hero (only editor sees controls)
  if (files.length === 0) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        {isEditor ? (
          <div className="card" style={{ padding: 24, maxWidth: 520, textAlign: "center" }}>
            <h2 style={{ marginTop: 0 }}>Start your session</h2>
            <p>Upload your <strong>folder</strong>/<strong>files</strong> or <strong>create</strong> a new one to start collaborating.</p>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 8 }}>
              <button onClick={() => fileInputRef.current?.click()} disabled={!wsReady}>Upload files</button>
              <button onClick={() => dirInputRef.current?.click()} disabled={!wsReady}>Upload folder</button>
              <button onClick={createFile} disabled={!wsReady}>Create new file</button>
            </div>

            {/* hidden inputs */}
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onUploadFiles} />
            <input ref={dirInputRef} type="file" multiple webkitdirectory="true" directory="true" style={{ display: "none" }} onChange={onUploadFolder} />
          </div>
        ) : (
          <div style={{ color: "#666" }}>Waiting for the owner to upload or create files…</div>
        )}
      </div>
    );
  }

  // Normal editor UI when there is at least one file
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #ddd", display: "flex", gap: 8, alignItems: "center" }}>
        <strong>Room:</strong> <code>{roomId}</code>
        <span style={{ marginLeft: 12 }} />
        <strong>Current editor:</strong> <span>{editor || "—"}</span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {!isEditor && (
            <>
              <button onClick={requestTurn} disabled={!wsReady}>Request turn</button>
              <button onClick={proposeChange} disabled={!wsReady}>Propose change</button>
            </>
          )}

          {isEditor && requests.length > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span>Requests:</span>
              {requests.map((u) => (
                <span key={u} style={{ border: "1px solid #ddd", padding: "2px 6px", borderRadius: 6 }}>
                  <strong>{u}</strong>{" "}
                  <button onClick={() => approveTurn(u)} disabled={!wsReady}>Accept</button>{" "}
                  <button onClick={() => denyTurn(u)} disabled={!wsReady}>Deny</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <Editor
          height="100%"
          defaultLanguage="python"
          value={fileContent}
          onChange={onChange}
          options={{
            readOnly: !isEditor || !wsReady || !currentFile,
            minimap: { enabled: false },
            fontSize: 14,
          }}
        />
      </div>

      <div style={{ borderTop: "1px solid #ddd" }}>
        <Suggestions
          suggestions={suggestions}
          clear={() => setSuggestions([])}
          accept={(s) => {
            if (!isEditor || s.path !== currentFile) return;
            setFiles((prev) => prev.map((f) => (f.path === s.path ? { ...f, content: s.value } : f)));
            send({ type: "code", path: s.path, value: s.value });
          }}
        />
      </div>
    </div>
  );
}

