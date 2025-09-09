import React, { useState, useEffect, useCallback, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, useParams } from "react-router-dom";
import Lobby from "./Lobby.jsx";
import FileExplorer from "./FileExplorer.jsx";
import CodeEditor from "./Editor.jsx";
import Chat from "./Chat.jsx";

/** Compute WebSocket base URL:
 *  - Use VITE_WS_BASE if set (e.g. ws://backend:8000 in Docker).
 *  - Else derive from current origin (http->ws, https->wss).
 */
export function getWsBase() {
  const envBase = import.meta.env.VITE_WS_BASE;
  if (envBase) return envBase.replace(/\/+$/, "");
  return window.location.origin.replace(/^http/, "ws");
}

/** Room layout: file explorer (left), editor (center), chat (right). */
function Room({ user }) {
  const { roomId } = useParams();
  const [socket, setSocket] = useState(null);
  const [wsReady, setWsReady] = useState(false);

  // Very small in-memory file model (one file by default)
  const [files, setFiles] = useState([{ path: "main.py", content: "" }]);
  const [currentFile, setCurrentFile] = useState("main.py");

  // Queue for messages sent while the socket is not yet OPEN
  const pendingRef = useRef([]);

  useEffect(() => {
    if (!user) return;

    const ws = new WebSocket(`${getWsBase()}/ws/${roomId}`);

    const onOpen = () => {
      // Application-level join first
      ws.send(JSON.stringify({ type: "join", user: user.username }));
      setWsReady(true);

      // Flush queued messages
      for (const msg of pendingRef.current) ws.send(JSON.stringify(msg));
      pendingRef.current = [];
    };

    const onCloseOrErr = () => setWsReady(false);

    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onCloseOrErr);
    ws.addEventListener("error", onCloseOrErr);

    setSocket(ws);
    return () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onCloseOrErr);
      ws.removeEventListener("error", onCloseOrErr);
      ws.close();
    };
  }, [user, roomId]);

  /** Safe sender:
   *  - If OPEN, send immediately.
   *  - Else enqueue; it will be flushed on 'open'.
   */
  const safeSend = useCallback(
    (payload) => {
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      } else {
        pendingRef.current.push(payload);
      }
    },
    [socket]
  );

  if (!user) return <div className="container">Please go back and enter your name first.</div>;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: 2, borderRight: "1px solid #999" }}>
        <FileExplorer
          files={files}
          currentFile={currentFile}
          setCurrentFile={setCurrentFile}
        />
      </div>

      <div style={{ flex: 5, borderRight: "1px solid #999" }}>
        {socket && (
          <CodeEditor
            roomId={roomId}
            user={user}
            socket={socket}
            send={safeSend}
            wsReady={wsReady}
            files={files}
            currentFile={currentFile}
            setFiles={setFiles}
          />
        )}
      </div>

      <div style={{ flex: 3 }}>
        {socket && <Chat user={user} socket={socket} send={safeSend} wsReady={wsReady} />}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Lobby setUser={setUser} />} />
        <Route path="/room/:roomId" element={<Room user={user} />} />
      </Routes>
    </Router>
  );
}

