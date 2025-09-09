import React, { useEffect, useState, useRef } from "react";
import Editor from "@monaco-editor/react";
import Suggestions from "./Suggestions.jsx";

/**
 * Code editor component with:
 * - app-level handshake: handles "ready" (initial snapshot from server)
 * - real-time updates: applies "code" broadcasts
 * - turn-taking: respects "turn_update" (who can edit)
 * - suggestions: visible only to current editor (can be adjusted)
 *
 * Props:
 *  - roomId, user
 *  - socket: native WebSocket instance (already connected)
 *  - send: function(payload) => safe send (queues while CONNECTING)
 *  - wsReady: boolean, OPEN state of the websocket
 *  - files: [{ path, content }]
 *  - currentFile: string
 *  - setFiles: (updater) => void
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
  const [editor, setEditor] = useState(null); // current editor username
  const [suggestions, setSuggestions] = useState([]);
  const initialisedRef = useRef(false); // avoid re-applying snapshot multiple times

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);

      // 1) Server snapshot on join
      if (data.type === "ready") {
        // Initialize local editor + file list from server
        setEditor(data.editor || null);

        if (data.files && typeof data.files === "object") {
          // Convert { "path": "content" } -> [{ path, content }]
          const list = Object.entries(data.files).map(([path, content]) => ({
            path,
            content,
          }));

          // Apply snapshot only once on the first ready
          if (!initialisedRef.current) {
            setFiles(list);
            initialisedRef.current = true;
          }
        }
        return;
      }

      // 2) Turn-taking updates
      if (data.type === "turn_update") {
        setEditor(data.editor);
        return;
      }

      // 3) Code updates (apply to the relevant file)
      if (data.type === "code" && data.path) {
        setFiles((prev) =>
          prev.map((f) =>
            f.path === data.path ? { ...f, content: data.value } : f
          )
        );
        return;
      }

      // 4) Suggestions (only shown to the active editor)
      if (data.type === "suggestion" && editor === user.username) {
        setSuggestions((prev) => [...prev, data]);
        return;
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket, editor, user?.username, setFiles]);

  // Local on-change: only the active editor can broadcast changes
  const onChange = (value) => {
    if (editor !== user.username || !currentFile) return;

    // Optimistic local update
    setFiles((prev) =>
      prev.map((f) => (f.path === currentFile ? { ...f, content: value } : f))
    );

    // Broadcast to room
    send({ type: "code", path: currentFile, value });
  };

  const requestTurn = () => {
    send({ type: "take_turn", user: user.username });
  };

  const proposeChange = () => {
    if (!currentFile) return;
    const file = files.find((f) => f.path === currentFile);
    const content = file ? file.content : "";
    const suggestion = prompt("Enter your suggestion for this file:", content);
    if (suggestion) {
      send({
        type: "suggestion",
        user: user.username,
        path: currentFile,
        value: suggestion,
      });
    }
  };

  const fileContent =
    files.find((f) => f.path === currentFile)?.content ?? "";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: 8,
          borderBottom: "1px solid #ddd",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <strong>Room:</strong> <code>{roomId}</code>
        <span style={{ marginLeft: 12 }} />
        <strong>Current editor:</strong> <span>{editor || "—"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={requestTurn} disabled={!wsReady}>
            Request turn
          </button>
          <button onClick={proposeChange} disabled={!wsReady}>
            Propose change
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <Editor
          height="100%"
          defaultLanguage="python"
          value={fileContent}
          onChange={onChange}
          options={{
            readOnly: editor !== user.username || !wsReady,
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
            // Only the active editor can accept and apply a suggestion
            if (editor !== user.username) return;
            if (s.path !== currentFile) return;

            setFiles((prev) =>
              prev.map((f) =>
                f.path === s.path ? { ...f, content: s.value } : f
              )
            );
            send({ type: "code", path: s.path, value: s.value });
          }}
        />
      </div>
    </div>
  );
}

