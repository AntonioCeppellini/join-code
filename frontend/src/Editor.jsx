import React, { useEffect, useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import Suggestions from "./Suggestions.jsx";

/**
 * Code editor with:
 * - "ready" snapshot on join
 * - turn-taking with approval (request_turn / approve_turn / deny_turn)
 * - code real-time updates
 * - suggestions visible to current editor
 */
export default function CodeEditor({
  roomId,
  user,
  socket,
  send,
  wsReady,
  files,
  currentFile,
  setFiles,
}) {
  const [editor, setEditor] = useState(null);       // username of current editor
  const [suggestions, setSuggestions] = useState([]);
  const [requests, setRequests] = useState([]);     // pending turn requests (usernames)
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "ready") {
        setEditor(data.editor || null);
        if (data.files && typeof data.files === "object" && !initialisedRef.current) {
          const list = Object.entries(data.files).map(([path, content]) => ({ path, content }));
          setFiles(list);
          initialisedRef.current = true;
        }
        return;
      }

      if (data.type === "turn_update") {
        setEditor(data.editor);
        // Clear processed requests if we became editor or editor changed
        setRequests((prev) => prev.filter((u) => u !== data.editor));
        return;
      }

      if (data.type === "request_turn") {
        // Only the current editor should see actionable requests
        if (user.username === editor && !requests.includes(data.user)) {
          setRequests((prev) => [...prev, data.user]);
        }
        // Small feedback for requester
        if (data.user === user.username && user.username !== editor) {
          // no-op or toast client-side
        }
        return;
      }

      if (data.type === "deny_turn" && data.user === user.username) {
        // Editor denied our request → display a tiny toast/alert
        // (simple alert for now)
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
          if (exists) return prev.map((f) => (f.path === data.path ? { ...f, content: data.content ?? "" } : f));
          return [...prev, { path: data.path, content: data.content ?? "" }];
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
  }, [socket, editor, user?.username, setFiles, requests]);

  const onChange = (value) => {
    if (editor !== user.username || !currentFile) return;
    setFiles((prev) => prev.map((f) => (f.path === currentFile ? { ...f, content: value } : f)));
    send({ type: "code", path: currentFile, value });
  };

  // Non-editor → request the turn
  const requestTurn = () => {
    if (editor === user.username) return;
    send({ type: "request_turn", user: user.username });
  };

  // Editor actions
  const approveTurn = (username) => {
    send({ type: "approve_turn", user: username });
    setRequests((prev) => prev.filter((u) => u !== username));
  };
  const denyTurn = (username) => {
    send({ type: "deny_turn", user: username });
    setRequests((prev) => prev.filter((u) => u !== username));
  };

  const proposeChange = () => {
    if (!currentFile) return;
    const file = files.find((f) => f.path === currentFile);
    const content = file ? file.content : "";
    const suggestion = prompt("Enter your suggestion for this file:", content);
    if (suggestion) {
      send({ type: "suggestion", user: user.username, path: currentFile, value: suggestion });
    }
  };

  const fileContent = files.find((f) => f.path === currentFile)?.content ?? "";
  const isEditor = editor === user.username;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #ddd", display: "flex", gap: 8, alignItems: "center" }}>
        <strong>Room:</strong> <code>{roomId}</code>
        <span style={{ marginLeft: 12 }} />
        <strong>Current editor:</strong> <span>{editor || "—"}</span>

        {/* Right side controls */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* Non-editor sees request/propose */}
          {!isEditor && (
            <>
              <button onClick={requestTurn} disabled={!wsReady}>Request turn</button>
              <button onClick={proposeChange} disabled={!wsReady}>Propose change</button>
            </>
          )}

          {/* Editor sees pending requests with Accept/Deny */}
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
            readOnly: !isEditor || !wsReady,
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

