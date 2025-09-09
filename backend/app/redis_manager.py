import redis
import json
import asyncio
import os

# Redis URL (must be set, no fallback)
REDIS_URL = os.getenv("REDIS_URL")

if not REDIS_URL:
    raise RuntimeError("[FATAL] REDIS_URL environment variable is not set!")

print(f"[INFO] Using REDIS_URL={REDIS_URL}")

class RedisManager:
    """
    Handles Redis pub/sub.
    Used to synchronize multiple backend instances.
    Redis is required: if it is not available, the backend cannot start.
    """

    def __init__(self):
        # Connect to Redis and test immediately
        self.redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        self.redis.ping()  # raise error if Redis not reachable
        print(f"[INFO] Connected to Redis at {REDIS_URL}")
        self.pubsub = self.redis.pubsub()

    async def publish(self, channel: str, message: dict):
        """Publish a JSON message on a Redis channel."""
        try:
            self.redis.publish(channel, json.dumps(message))
            print(f"[DEBUG] Published to {channel}: {message}")
        except Exception as e:
            print(f"[ERROR] Failed to publish to Redis: {e}")
            raise

    async def subscribe(self, channel: str, callback):
        """
        Subscribe to a Redis channel in a non-blocking way.
        The callback is executed for every message.
        """
        def reader():
            try:
                self.pubsub.subscribe(channel)
                print(f"[INFO] Subscribed to Redis channel: {channel}")
                for message in self.pubsub.listen():
                    if message["type"] == "message":
                        data = json.loads(message["data"])
                        # Run callback in the event loop
                        asyncio.run(callback(data))
            except Exception as e:
                print(f"[ERROR] Redis subscription failed: {e}")
                raise

        # Run the blocking listener in a separate thread
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, reader)

