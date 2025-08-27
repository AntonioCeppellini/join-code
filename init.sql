-- Script di inizializzazione per PostgreSQL
-- Questo file viene eseguito automaticamente quando il container viene avviato per la prima volta

-- Crea estensioni utili
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Crea le tabelle principali (ridondante ma sicuro)
CREATE TABLE IF NOT EXISTS rooms (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    content TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suggestions (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(255) REFERENCES rooms(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    line_start INTEGER NOT NULL DEFAULT 0,
    line_end INTEGER NOT NULL DEFAULT 0,
    original_code TEXT DEFAULT '',
    suggested_code TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(255) REFERENCES rooms(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Crea indici per migliorare le performance
CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms(last_updated);
CREATE INDEX IF NOT EXISTS idx_suggestions_room_status ON suggestions(room_id, status);
CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_room_timestamp ON chat_history(room_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_history(user_id);

-- Crea una stanza demo (opzionale)
INSERT INTO rooms (id, name, content) 
VALUES (
    'demo', 
    'Stanza Demo', 
    '# 🚀 Benvenuto in Joincode!

## Cosa puoi fare qui:

### 1. Collaborazione in tempo reale
- Richiedi il **lock** per modificare il codice
- Gli altri vedono le tue modifiche in tempo reale

### 2. Sistema di suggerimenti
- Chi non ha il lock può proporre modifiche
- I suggerimenti vengono inviati a chi controlla l''editor

### 3. Chat integrata
- Comunica con il tuo team
- Discuti il codice senza interferire

### 4. Import di codice
- Carica file dal tuo computer
- Clona direttamente da repository Git

```python
# Esempio di codice Python
def saluta(nome):
    """Funzione di saluto personalizzata"""
    return f"Ciao {nome}! Benvenuto in Joincode! 🎉"

# Prova a modificare questo codice!
utente = "Sviluppatore"
print(saluta(utente))

# TODO: Aggiungi la tua funzione qui sotto
```

> 💡 **Suggerimento**: Premi il pulsante "Richiedi Lock" per iniziare a modificare!'
) ON CONFLICT (id) DO NOTHING;

-- Messaggio di benvenuto nei log
DO $$
BEGIN
    RAISE NOTICE '🎉 Database Joincode inizializzato con successo!';
    RAISE NOTICE '📊 Tabelle create: rooms, suggestions, chat_history';
    RAISE NOTICE '🏠 Stanza demo disponibile all''indirizzo: /demo';
END $$;
