import json
import os
import subprocess
import tempfile
import shutil
import hashlib
from datetime import datetime
from urllib.parse import urlparse
from typing import Dict, List, Optional

import asyncpg
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Joincode", description="Collaborative Code Editor")

# --- Database Configuration ---
DATABASE_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "user": os.getenv("DB_USER", "joincode_user"),
    "password": os.getenv("DB_PASSWORD", "joincode_password"),
    "database": os.getenv("DB_NAME", "joincode_db")
}

# Pool di connessioni globale
db_pool = None

async def init_database():
    """Inizializza il database PostgreSQL e crea le tabelle necessarie"""
    global db_pool
    
    try:
        # Crea il pool di connessioni
        db_pool = await asyncpg.create_pool(**DATABASE_CONFIG, min_size=5, max_size=20)
        
        # Crea le tabelle se non esistono
        async with db_pool.acquire() as conn:
            # Tabella per le stanze
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS rooms (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255),
                    content TEXT DEFAULT '',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Tabella per i suggerimenti
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS suggestions (
                    id SERIAL PRIMARY KEY,
                    room_id VARCHAR(255) REFERENCES rooms(id) ON DELETE CASCADE,
                    user_id VARCHAR(255),
                    line_start INTEGER,
                    line_end INTEGER,
                    original_code TEXT,
                    suggested_code TEXT,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Tabella per la cronologia dei messaggi
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS chat_history (
                    id SERIAL PRIMARY KEY,
                    room_id VARCHAR(255) REFERENCES rooms(id) ON DELETE CASCADE,
                    user_id VARCHAR(255),
                    message TEXT,
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Indici per migliorare le performance
            await conn.execute('CREATE INDEX IF NOT EXISTS idx_suggestions_room_status ON suggestions(room_id, status)')
            await conn.execute('CREATE INDEX IF NOT EXISTS idx_chat_room_timestamp ON chat_history(room_id, timestamp)')
            
        print("✅ Database PostgreSQL inizializzato con successo")
        
    except Exception as e:
        print(f"❌ Errore nell'inizializzazione del database: {e}")
        raise

async def close_database():
    """Chiude il pool di connessioni al database"""
    global db_pool
    if db_pool:
        await db_pool.close()

# Event handlers per l'applicazione
@app.on_event("startup")
async def startup_event():
    await init_database()

@app.on_event("shutdown") 
async def shutdown_event():
    await close_database()

# --- Stato Globale del Server ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.room_lock_holder: Dict[str, Dict] = {}  # {room_id: {"ws": WebSocket, "user": str}}
        self.room_users: Dict[str, Dict[WebSocket, str]] = {}  # {room_id: {websocket: user_id}}
        
    async def connect(self, websocket: WebSocket, room_id: str, user_id: str):
        await websocket.accept()
        
        # Inizializza la stanza se non exists
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
            self.room_lock_holder[room_id] = {"ws": None, "user": None}
            self.room_users[room_id] = {}
            
            # Crea la stanza nel database se non esiste
            await self.create_room_if_not_exists(room_id)
        
        self.active_connections[room_id].append(websocket)
        self.room_users[room_id][websocket] = user_id
        
        # Sincronizza il contenuto attuale
        content = await self.get_room_content(room_id)
        await websocket.send_text(json.dumps({
            "type": "sync", 
            "content": content
        }))
        
        # Carica cronologia chat
        chat_history = await self.get_chat_history(room_id)
        for msg in chat_history:
            await websocket.send_text(json.dumps({
                "type": "chat_message",
                "user": msg['user_id'],
                "message": msg['message'],
                "timestamp": msg['timestamp'].isoformat()
            }))
        
        # Carica suggerimenti pendenti
        suggestions = await self.get_pending_suggestions(room_id)
        for suggestion in suggestions:
            await websocket.send_text(json.dumps({
                "type": "suggestion",
                "id": suggestion['id'],
                "user": suggestion['user_id'],
                "line_start": suggestion['line_start'],
                "line_end": suggestion['line_end'],
                "original_code": suggestion['original_code'],
                "suggested_code": suggestion['suggested_code'],
                "status": suggestion['status']
            }))
        
        await self.broadcast(room_id, {
            "type": "user_joined", 
            "message": f"👋 {user_id} si è unito alla stanza.",
            "users": self.get_room_users(room_id)
        })

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id not in self.active_connections:
            return
            
        user_id = self.room_users[room_id].get(websocket, "Unknown")
        
        if websocket in self.active_connections[room_id]:
            self.active_connections[room_id].remove(websocket)
            
        if websocket in self.room_users[room_id]:
            del self.room_users[room_id][websocket]
            
        # Rilascia il lock se l'utente disconnesso lo possedeva
        if self.room_lock_holder.get(room_id, {}).get("ws") == websocket:
            self.room_lock_holder[room_id] = {"ws": None, "user": None}
            self.broadcast_sync(room_id, {
                "type": "lock_released", 
                "message": f"🔓 Editor sbloccato ('{user_id}' disconnesso)."
            })
        
        # Cleanup se stanza vuota
        if not self.active_connections[room_id]:
            del self.active_connections[room_id]
            if room_id in self.room_lock_holder:
                del self.room_lock_holder[room_id]
            if room_id in self.room_users:
                del self.room_users[room_id]
        else:
            self.broadcast_sync(room_id, {
                "type": "user_left",
                "message": f"👋 {user_id} ha lasciato la stanza.",
                "users": self.get_room_users(room_id)
            })

    async def broadcast(self, room_id: str, data: dict):
        if room_id not in self.active_connections:
            return
        for connection in self.active_connections[room_id]:
            try:
                await connection.send_text(json.dumps(data))
            except:
                pass  # Connection potrebbe essere chiusa

    def broadcast_sync(self, room_id: str, data: dict):
        import asyncio
        if room_id not in self.active_connections:
            return
        for connection in self.active_connections[room_id]:
            try:
                asyncio.create_task(connection.send_text(json.dumps(data)))
            except:
                pass

    def get_room_users(self, room_id: str) -> List[str]:
        if room_id not in self.room_users:
            return []
        return list(self.room_users[room_id].values())

    # --- Database Operations ---
    async def create_room_if_not_exists(self, room_id: str):
        async with db_pool.acquire() as conn:
            result = await conn.fetchrow('SELECT id FROM rooms WHERE id = $1', room_id)
            if not result:
                await conn.execute(
                    'INSERT INTO rooms (id, name, content) VALUES ($1, $2, $3)',
                    room_id, f"Stanza {room_id}", f"# Benvenuto nella stanza '{room_id}'\n# Inizia a programmare insieme!"
                )

    async def get_room_content(self, room_id: str) -> str:
        async with db_pool.acquire() as conn:
            result = await conn.fetchrow('SELECT content FROM rooms WHERE id = $1', room_id)
            return result['content'] if result else ""

    async def update_room_content(self, room_id: str, content: str):
        async with db_pool.acquire() as conn:
            await conn.execute(
                'UPDATE rooms SET content = $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
                content, room_id
            )

    async def save_chat_message(self, room_id: str, user_id: str, message: str):
        async with db_pool.acquire() as conn:
            await conn.execute(
                'INSERT INTO chat_history (room_id, user_id, message) VALUES ($1, $2, $3)',
                room_id, user_id, message
            )

    async def get_chat_history(self, room_id: str, limit: int = 50):
        async with db_pool.acquire() as conn:
            results = await conn.fetch(
                'SELECT id, user_id, message, timestamp FROM chat_history WHERE room_id = $1 ORDER BY timestamp DESC LIMIT $2',
                room_id, limit
            )
            return list(reversed(results))  # Cronologico

    async def create_suggestion(self, room_id: str, user_id: str, line_start: int, line_end: int, original_code: str, suggested_code: str):
        async with db_pool.acquire() as conn:
            result = await conn.fetchrow(
                'INSERT INTO suggestions (room_id, user_id, line_start, line_end, original_code, suggested_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                room_id, user_id, line_start, line_end, original_code, suggested_code
            )
            return result['id']

    async def get_pending_suggestions(self, room_id: str):
        async with db_pool.acquire() as conn:
            results = await conn.fetch(
                'SELECT * FROM suggestions WHERE room_id = $1 AND status = $2 ORDER BY created_at',
                room_id, 'pending'
            )
            return results

    async def update_suggestion_status(self, suggestion_id: int, status: str):
        async with db_pool.acquire() as conn:
            await conn.execute(
                'UPDATE suggestions SET status = $1 WHERE id = $2',
                status, suggestion_id
            )

    async def get_room_stats(self, room_id: str):
        """Ottiene statistiche sulla stanza"""
        async with db_pool.acquire() as conn:
            # Conta messaggi
            message_count = await conn.fetchval(
                'SELECT COUNT(*) FROM chat_history WHERE room_id = $1',
                room_id
            )
            
            # Conta suggerimenti
            suggestion_count = await conn.fetchval(
                'SELECT COUNT(*) FROM suggestions WHERE room_id = $1',
                room_id
            )
            
            # Ultima attività
            last_activity = await conn.fetchval(
                'SELECT MAX(last_updated) FROM rooms WHERE id = $1',
                room_id
            )
            
            return {
                "message_count": message_count,
                "suggestion_count": suggestion_count,
                "last_activity": last_activity
            }

manager = ConnectionManager()

# --- Utility Functions ---
def safe_git_clone(repo_url: str, file_path: str):
    parsed_url = urlparse(repo_url)
    if parsed_url.scheme not in ['http', 'https']:
        raise ValueError("❌ URL repository deve utilizzare HTTPS")
    
    if '..' in file_path or file_path.startswith('/'):
        raise ValueError("❌ Percorso file non valido")
    
    temp_dir = tempfile.mkdtemp()
    try:
        result = subprocess.run(
            ['git', 'clone', '--depth', '1', repo_url, temp_dir],
            check=True, timeout=60, capture_output=True, text=True
        )
        
        full_file_path = os.path.join(temp_dir, file_path)
        
        if not os.path.abspath(full_file_path).startswith(os.path.abspath(temp_dir)):
            raise ValueError("❌ Tentativo di accesso a file fuori dal repository")
        
        if not os.path.isfile(full_file_path):
            # Cerca file simili
            for root, dirs, files in os.walk(temp_dir):
                for file in files:
                    if file_path.split('/')[-1] in file:
                        full_file_path = os.path.join(root, file)
                        break
                if os.path.isfile(full_file_path):
                    break
            else:
                raise FileNotFoundError(f"❌ File '{file_path}' non trovato nel repository")
            
        with open(full_file_path, 'r', encoding='utf-8') as f:
            return f.read()
            
    except subprocess.TimeoutExpired:
        raise ValueError("❌ Timeout durante il clone del repository")
    except subprocess.CalledProcessError as e:
        raise ValueError(f"❌ Errore Git: {e.stderr}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

# --- Routes ---
@app.get("/")
async def get_index():
    return FileResponse("index.html")

@app.get("/rooms/{room_id}/info")
async def get_room_info(room_id: str):
    async with db_pool.acquire() as conn:
        room = await conn.fetchrow('SELECT * FROM rooms WHERE id = $1', room_id)
        
        if not room:
            return {"error": "Room not found"}
        
        # Ottieni statistiche aggiuntive
        stats = await manager.get_room_stats(room_id)
        
        return {
            "id": room['id'],
            "name": room['name'],
            "created_at": room['created_at'].isoformat(),
            "last_updated": room['last_updated'].isoformat(),
            "users": manager.get_room_users(room_id),
            "has_lock": manager.room_lock_holder.get(room_id, {}).get("user"),
            "stats": stats
        }

# --- Main WebSocket Endpoint ---
@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    await manager.connect(websocket, room_id, user_id)
    
    try:
        while True:
            raw_data = await websocket.receive_text()
            data = json.loads(raw_data)
            msg_type = data.get("type")
            
            # Verifica se l'utente ha il lock
            lock_info = manager.room_lock_holder.get(room_id, {})
            has_lock = lock_info.get("ws") == websocket
            
            # --- Gestione Lock ---
            if msg_type == "request_lock":
                if lock_info.get("ws") is None:
                    manager.room_lock_holder[room_id] = {"ws": websocket, "user": user_id}
                    await websocket.send_text(json.dumps({"type": "lock_granted"}))
                    await manager.broadcast(room_id, {
                        "type": "info", 
                        "message": f"🔒 '{user_id}' ha preso il controllo dell'editor."
                    })
                else:
                    await websocket.send_text(json.dumps({"type": "lock_denied"}))
                    
            elif msg_type == "release_lock":
                if has_lock:
                    manager.room_lock_holder[room_id] = {"ws": None, "user": None}
                    await websocket.send_text(json.dumps({"type": "lock_released"}))
                    await manager.broadcast(room_id, {
                        "type": "info", 
                        "message": f"🔓 '{user_id}' ha rilasciato il controllo."
                    })
            
            # --- Modifica Codice ---
            elif msg_type == "code_update":
                if has_lock:
                    content = data.get("content", "")
                    await manager.update_room_content(room_id, content)
                    await manager.broadcast(room_id, {"type": "sync", "content": content})
            
            # --- Chat ---
            elif msg_type == "chat_message":
                message = data.get("message", "").strip()
                if message:
                    await manager.save_chat_message(room_id, user_id, message)
                    await manager.broadcast(room_id, {
                        "type": "chat_message", 
                        "user": user_id, 
                        "message": message,
                        "timestamp": datetime.now().isoformat()
                    })
            
            # --- Import Operations (solo con lock) ---
            elif msg_type == "file_upload":
                if not has_lock:
                    await websocket.send_text(json.dumps({
                        "type": "error", 
                        "message": "❌ Devi avere il lock per caricare file."
                    }))
                    continue
                    
                content = data.get("content", "")
                filename = data.get("filename", "file caricato")
                await manager.update_room_content(room_id, content)
                await manager.broadcast(room_id, {"type": "sync", "content": content})
                await manager.broadcast(room_id, {
                    "type": "info", 
                    "message": f"📄 '{user_id}' ha caricato '{filename}'."
                })
                
            elif msg_type == "git_clone":
                if not has_lock:
                    await websocket.send_text(json.dumps({
                        "type": "error", 
                        "message": "❌ Devi avere il lock per clonare repository."
                    }))
                    continue
                    
                try:
                    repo_url = data.get("repo_url", "").strip()
                    file_path = data.get("file_path", "").strip()
                    
                    if not repo_url or not file_path:
                        raise ValueError("URL repository e percorso file sono obbligatori")
                        
                    content = safe_git_clone(repo_url, file_path)
                    await manager.update_room_content(room_id, content)
                    await manager.broadcast(room_id, {"type": "sync", "content": content})
                    await manager.broadcast(room_id, {
                        "type": "info", 
                        "message": f"🌐 '{user_id}' ha caricato '{file_path}' da Git."
                    })
                except Exception as e:
                    await websocket.send_text(json.dumps({
                        "type": "error", 
                        "message": str(e)
                    }))
            
            # --- Sistema Suggerimenti ---
            elif msg_type == "create_suggestion":
                if has_lock:
                    await websocket.send_text(json.dumps({
                        "type": "error", 
                        "message": "❌ Non puoi creare suggerimenti quando hai il lock."
                    }))
                    continue
                
                line_start = data.get("line_start", 0)
                line_end = data.get("line_end", 0)
                original_code = data.get("original_code", "")
                suggested_code = data.get("suggested_code", "")
                
                suggestion_id = await manager.create_suggestion(
                    room_id, user_id, line_start, line_end, original_code, suggested_code
                )
                
                # Invia il suggerimento solo a chi ha il lock
                if lock_info.get("ws"):
                    await lock_info["ws"].send_text(json.dumps({
                        "type": "suggestion",
                        "id": suggestion_id,
                        "user": user_id,
                        "line_start": line_start,
                        "line_end": line_end,
                        "original_code": original_code,
                        "suggested_code": suggested_code,
                        "status": "pending"
                    }))
                
                await manager.broadcast(room_id, {
                    "type": "info",
                    "message": f"💡 '{user_id}' ha inviato un suggerimento."
                })
            
            elif msg_type == "handle_suggestion":
                if not has_lock:
                    await websocket.send_text(json.dumps({
                        "type": "error", 
                        "message": "❌ Solo chi ha il lock può gestire i suggerimenti."
                    }))
                    continue
                
                suggestion_id = data.get("suggestion_id")
                action = data.get("action")  # "accept" or "reject"
                
                if action in ["accept", "reject"]:
                    status = "accepted" if action == "accept" else "rejected"
                    await manager.update_suggestion_status(suggestion_id, status)
                    
                    if action == "accept":
                        # Applica il suggerimento
                        suggested_code = data.get("suggested_code", "")
                        # Qui dovresti implementare la logica per applicare il suggerimento al codice
                        # Per semplicità, assumiamo che il frontend gestisca l'applicazione
                        pass
                    
                    await manager.broadcast(room_id, {
                        "type": "suggestion_handled",
                        "suggestion_id": suggestion_id,
                        "action": action,
                        "message": f"💡 Suggerimento {status} da '{user_id}'."
                    })

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        print(f"🔌 {user_id} disconnesso dalla stanza {room_id}")

if __name__ == "__main__":
    import uvicorn
    print("🚀 Avvio Joincode Server...")
    print("📝 Accedi a: http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
