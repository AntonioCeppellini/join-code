import React, { useState, useEffect, useCallback, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, useParams } from "react-router-dom";
import Lobby from "./Lobby.jsx";
import FileExplorer from "./FileExplorer.jsx";
import CodeEditor from "./Editor.jsx";
import Chat from "./Chat.jsx";

export function getWsBase() {
  const envBase = import.meta.env.VITE_WS_BASE;
  if (envBase) return envBase.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "ws://localhost:8000";
  return window.location.origin.replace(/^http/, "ws");
}

function Room({ user }) {
  const { roomId } = useParams();
  const [socket, setSocket] = useState(null);
  const [wsReady, setWsReady] = useState(false);

  const [files, setFiles] = useState([{ path: "main.py", content: "" }]);
  const [currentFile, setCurrentFile] = useState("main.py");

  const pendingRef = useRef([]);

  useEffect(() => {
    if (!user) return;
    const url = `${getWsBase()}/ws/${roomId}`;
    const ws = new WebSocket(url);

    const onOpen = () => {
      ws.send(JSON.stringify({ type: "join", user: user.username }));
      setWsReady(true);
      for (const m of pendingRef.current) ws.send(JSON.stringify(m));
      pendingRef.current = [];
    };
    const onDown = () => setWsReady(false);

    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onDown);
    ws.addEventListener("error", onDown);

    setSocket(ws);
    return () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onDown);
      ws.removeEventListener("error", onDown);
      ws.close();
    };
  }, [user, roomId]);

  const safeSend = useCallback(
    (payload) => {
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
      else pendingRef.current.push(payload);
    },
    [socket]
  );

  if (!user) return <div className="container">Please go back and enter your name first.</div>;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: 2, borderRight: "1px solid #999" }}>
        <FileExplorer
          files={files}
          setFiles={setFiles}
          currentFile={currentFile}
          setCurrentFile={setCurrentFile}
          send={safeSend}
          wsReady={wsReady}
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

