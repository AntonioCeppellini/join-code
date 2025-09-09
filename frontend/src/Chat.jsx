import React, { useEffect, useState } from "react";

/** Chat component.
 *  Broadcasts chat messages via WebSocket.
 */
export default function Chat({ user, socket, send, wsReady }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "chat") {
        setMessages((prev) => [...prev, data.value]);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    send({ type: "chat", value: `${user.username}: ${text}` });
    setInput("");
  };

  return (
    <div style={{ padding: 10, height: "100%", display: "flex", flexDirection: "column" }}>
      <h3>Chat {wsReady ? "" : "(connecting...)"}</h3>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          border: "1px solid #ccc",
          borderRadius: 6,
          marginBottom: 8,
          padding: 8
        }}
      >
        {messages.map((msg, i) => (
          <div key={i}>{msg}</div>
        ))}
      </div>

      <div className="row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={sendMessage} disabled={!wsReady}>Send</button>
      </div>
    </div>
  );
}

