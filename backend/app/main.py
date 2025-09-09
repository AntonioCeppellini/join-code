from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from .websocket_manager import ConnectionManager

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
manager = ConnectionManager()

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()

    join_data = await websocket.receive_json()
    if join_data.get("type") != "join":
        await websocket.close()
        return
    username = join_data.get("user", "guest")

    await manager.connect(websocket, room_id, username)

    try:
        while True:
            data = await websocket.receive_json()

            t = data.get("type")
            if t == "take_turn":
                await manager.set_editor(room_id, data.get("user", "guest"))
            elif t == "give_turn":
                await manager.set_editor(room_id, data.get("user", "guest"))
            else:
                # 'code', 'chat', 'suggestion', ...
                await manager.broadcast(data, room_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

