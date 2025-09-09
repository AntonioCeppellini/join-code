# backend/app/websocket_manager.py
from __future__ import annotations

import asyncio
import uuid
from typing import Dict, List, Any

from fastapi import WebSocket
from .redis_manager import RedisManager


class ConnectionManager:
    """
    Tracks rooms, WebSocket connections, current editor and file snapshots.
    Delivers messages to local clients and fans-out globally via Redis Pub/Sub.

    Delivery strategy (Option B):
      - immediate local send to this instance's clients
      - publish to Redis including an 'origin' instance id
      - subscriber ignores its own echoes and re-broadcasts locally on other instances
    """

    def __init__(self) -> None:
        # { doc_id: { "connections": [WebSocket,...],
        #             "current_editor": str,
        #             "files": { path: content } } }
        self.rooms: Dict[str, Dict[str, Any]] = {}

        # Unique id to deduplicate our own Redis echoes
        self.instance_id: str = uuid.uuid4().hex

        self.redis = RedisManager()
        # Start a single subscriber task at startup
        asyncio.create_task(self.listen_to_redis())

    # -------------------------------
    # Redis subscription loop
    # -------------------------------
    async def listen_to_redis(self) -> None:
        """Subscribe to Redis and re-broadcast messages locally (dedup on origin)."""

        async def handle_message(data: Dict[str, Any]) -> None:
            # Drop our own echo
            if data.get("origin") == self.instance_id:
                return

            doc_id = data.get("doc_id")
            payload = data.get("payload")

            if not doc_id or payload is None:
                return

            # Update in-memory snapshot for 'code' messages
            self._maybe_update_snapshot(doc_id, payload)

            # Fan-out ONLY to local connections (no re-publish)
            await self._send_local(doc_id, payload)

        await self.redis.subscribe("broadcast", handle_message)

    # -------------------------------
    # Connection lifecycle
    # -------------------------------
    async def connect(self, websocket: WebSocket, doc_id: str, username: str) -> None:
        """Add a new client to a room. First user becomes the editor."""
        if doc_id not in self.rooms:
            self.rooms[doc_id] = {
                "connections": [],
                "current_editor": username,    # first join is the editor
                "files": {"main.py": ""},      # minimal single-file snapshot
            }

        self.rooms[doc_id]["connections"].append(websocket)

        # Send application-level READY/SNAPSHOT to the newly joined client
        await websocket.send_json({
            "type": "ready",
            "doc_id": doc_id,
            "editor": self.rooms[doc_id]["current_editor"],
            "files": self.rooms[doc_id]["files"],  # dict: path -> content
        })

        # Inform local clients about current editor (optional UI refresh)
        await self._send_local(doc_id, {
            "type": "turn_update",
            "editor": self.rooms[doc_id]["current_editor"],
        })

    def disconnect(self, websocket: WebSocket, doc_id: str) -> None:
        """Remove a client, cleanup empty rooms."""
        room = self.rooms.get(doc_id)
        if not room:
            return

        conns: List[WebSocket] = room.get("connections", [])
        if websocket in conns:
            conns.remove(websocket)

        if not conns:
            # Drop the room when last connection leaves
            del self.rooms[doc_id]

    # -------------------------------
    # Broadcast / Send
    # -------------------------------
    async def broadcast(self, message: Dict[str, Any], doc_id: str) -> None:
        """
        Global broadcast:
          1) send locally to clients on this instance
          2) publish to Redis with 'origin' for other instances
        """
        # Update in-memory snapshot first (so local clients get the latest)
        self._maybe_update_snapshot(doc_id, message)

        # 1) Immediate local delivery
        await self._send_local(doc_id, message)

        # 2) Publish to Redis (other instances will deliver locally)
        await self.redis.publish("broadcast", {
            "origin": self.instance_id,
            "doc_id": doc_id,
            "payload": message,
        })

    async def _send_local(self, doc_id: str, message: Dict[str, Any]) -> None:
        """Deliver a message ONLY to local WebSocket clients of the given room."""
        for conn in list(self.rooms.get(doc_id, {}).get("connections", [])):
            try:
                await conn.send_json(message)
            except Exception:
                # Ignore broken sockets; cleanup occurs on disconnect path
                pass

    # -------------------------------
    # Room state helpers
    # -------------------------------
    def _maybe_update_snapshot(self, doc_id: str, message: Dict[str, Any]) -> None:
        """Update the room's file snapshot for 'code' messages."""
        if message.get("type") == "code" and message.get("path") is not None:
            room = self.rooms.get(doc_id)
            if not room:
                return
            files = room.setdefault("files", {})
            files[message["path"]] = message.get("value", "")

    async def set_editor(self, doc_id: str, username: str) -> None:
        """Update current editor and notify everyone (global)."""
        if doc_id not in self.rooms:
            # Initialize the room if something races
            self.rooms[doc_id] = {"connections": [], "current_editor": username, "files": {"main.py": ""}}
        self.rooms[doc_id]["current_editor"] = username
        await self.broadcast({"type": "turn_update", "editor": username}, doc_id)

