import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

/** Lobby lets a user set a nickname and either:
 *  - join an existing room by code
 *  - create a new room (client-side random code)
 */
export default function Lobby({ setUser }) {
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const navigate = useNavigate();

  function randomRoom() {
    // Short, URL-safe random id
    return Math.random().toString(36).slice(2, 8);
  }

  const onJoin = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setUser({ username: username.trim() });

    const code = roomCode.trim() || randomRoom();
    navigate(`/room/${code}`);
  };

  return (
    <div className="container">
      <h1>Join-Code</h1>
      <div className="card">
        <form onSubmit={onJoin}>
          <div style={{ marginBottom: 12 }}>
            <label>Nickname</label><br/>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your nickname"
              style={{ width: 300, padding: 8 }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Room code (optional: leave empty to create)</label><br/>
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="e.g. ab12cd"
              style={{ width: 300, padding: 8 }}
            />
          </div>

          <button type="submit" style={{ padding: "8px 16px" }}>
            Enter
          </button>
        </form>
      </div>
      <p style={{ marginTop: 8, color: "#666" }}>
        Tip: leaving the room code empty creates a new room automatically.
      </p>
    </div>
  );
}

