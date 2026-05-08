"""
Kick Chat Bot with AI
Connects to Kick chat, reads messages, and responds with AI-generated replies
"""
import logging
import asyncio
import json
import websockets
import time
import random
from typing import Optional, Callable, Dict, List
import threading
from queue import Queue

logger = logging.getLogger("kick_chat_bot")

class KickChatBot:
    def __init__(self, channel_name: str, auth_token: str = None, bot_instance=None):
        """
        Initialize Kick Chat Bot
        
        Args:
            channel_name: The Kick channel to monitor
            auth_token: Optional authentication token to send messages
        """
        self.channel_name = channel_name
        self.auth_token = auth_token
        self.bot_instance = bot_instance
        self.ws = None
        self.running = False
        self.channel_id = None
        self.chatroom_id = None
        
        # Message queues
        self.incoming_messages = Queue()
        self.outgoing_messages = Queue()
        
        # Callbacks
        self.on_message_callback: Optional[Callable] = None
        self.on_auto_chat_callback: Optional[Callable] = None
        self.on_connect_callback: Optional[Callable] = None
        self.on_disconnect_callback: Optional[Callable] = None
        
        # Rate limiting for responses
        self.last_response_time = 0
        self.min_response_interval = 3
        self.response_chance = 0.3
        
        # Conversation context
        self.recent_messages: List[Dict] = []
        self.max_context_messages = 10
        
    def set_response_settings(self, min_interval: int = 3, response_chance: float = 0.3):
        """Configure response behavior"""
        self.min_response_interval = min_interval
        self.response_chance = response_chance
        
    def on_message(self, callback: Callable):
        """Register callback for incoming messages"""
        self.on_message_callback = callback
        
    def on_auto_chat(self, callback: Callable):
        """Register callback for autonomous chatting"""
        self.on_auto_chat_callback = callback
        
    def on_connect(self, callback: Callable):
        """Register callback for connection"""
        self.on_connect_callback = callback
        
    def on_disconnect(self, callback: Callable):
        """Register callback for disconnection"""
        self.on_disconnect_callback = callback
    
    async def get_channel_info(self) -> bool:
        """Get channel ID and chatroom ID from Kick API"""
        try:
            if self.bot_instance and getattr(self.bot_instance, 'chatroom_id', None):
                self.channel_id = getattr(self.bot_instance, 'channel_id', None)
                self.chatroom_id = self.bot_instance.chatroom_id
                logger.info(f"✅ Channel info retrieved from ViewerBot: Chatroom={self.chatroom_id}")
                return True
                
            import tls_client
            
            def do_request():
                s = tls_client.Session(client_identifier="chrome_112", random_tls_extension_order=True)
                return s.get(
                    f'https://kick.com/api/v1/channels/{self.channel_name}',
                    headers={
                        "Accept": "application/json",
                        "Accept-Language": "en-US,en;q=0.9",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36"
                    },
                    timeout_seconds=10
                )
            
            # Try v1 API
            response = await asyncio.to_thread(do_request)
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    self.channel_id = data.get('id')
                    
                    # Get chatroom ID
                    if 'chatroom' in data:
                        self.chatroom_id = data['chatroom'].get('id')
                    
                    logger.info(f"✅ Channel info: ID={self.channel_id}, Chatroom={self.chatroom_id}")
                    return True
                except Exception as json_err:
                    # This happens when Cloudflare returns a 200 HTML page instead of JSON
                    logger.debug(f"Waiting for ViewerBot to resolve Cloudflare challenge...")
                    return False
            else:
                logger.debug(f"Failed to get channel info: {response.status_code}. Waiting for ViewerBot...")
                return False
                
        except Exception as e:
            logger.debug(f"Waiting for ViewerBot to establish channel info...")
            return False
    
    async def connect_to_chat(self):
        """Connect to Kick chat WebSocket"""
        try:
            # Get channel info first
            if not await self.get_channel_info():
                logger.error("Cannot connect without channel info")
                return False
            
            # Connect to Pusher WebSocket (Kick uses Pusher for chat)
            pusher_key = "32cbd69e4b950bf97679"  # Kick's NEW Pusher key
            ws_url = f"wss://ws-us2.pusher.com/app/{pusher_key}?protocol=7&client=js&version=7.0.3"
            
            self.ws = await websockets.connect(ws_url)
            logger.info("🔌 Connected to Kick chat WebSocket")
            
            # Wait for connection established
            connection_msg = await self.ws.recv()
            logger.debug(f"Connection message: {connection_msg}")
            
            # Subscribe to chatroom channel
            if self.chatroom_id:
                subscribe_msg = {
                    "event": "pusher:subscribe",
                    "data": {
                        "auth": "",
                        "channel": f"chatrooms.{self.chatroom_id}.v2"
                    }
                }
                await self.ws.send(json.dumps(subscribe_msg))
                logger.info(f"📡 Subscribed to chatroom {self.chatroom_id}")
            
            if self.on_connect_callback:
                self.on_connect_callback()
            
            # Automatically follow the channel if auth token is present
            if self.auth_token:
                asyncio.create_task(self.auto_follow())
            
            return True
            
        except Exception as e:
            logger.error(f"Error connecting to chat: {e}")
            return False
            
    async def auto_follow(self):
        """Automatically follow the channel using the provided auth tokens"""
        if not self.auth_token or not self.channel_name:
            return False
            
        try:
            tokens = [t.strip() for t in str(self.auth_token).split('\n') if t.strip()]
            import tls_client
            
            def do_follow(token):
                s = tls_client.Session(client_identifier="chrome_120", random_tls_extension_order=True)
                # First fetch kick.com to get cookies
                try:
                    s.get("https://kick.com", timeout_seconds=10)
                except:
                    pass
                    
                res = s.post(
                    f'https://kick.com/api/v2/channels/{self.channel_name}/follow',
                    headers={
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': f'Bearer {token}',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                )
                return res.status_code
                
            for token in tokens:
                status = await asyncio.to_thread(do_follow, token)
                if status in (200, 204):
                    logger.info(f"✅ Bot account automatically followed {self.channel_name}!")
                elif status == 403:
                    logger.debug(f"⚠️ Could not auto-follow (403 Forbidden) - Token may be invalid or Cloudflare blocked")
            
            return True
        except Exception as e:
            logger.debug(f"Error auto-following: {e}")
            return False
    
    async def listen_to_chat(self):
        """Listen for incoming chat messages"""
        try:
            while self.running and self.ws:
                try:
                    message = await asyncio.wait_for(self.ws.recv(), timeout=1.0)
                    await self.process_message(message)
                    
                except asyncio.TimeoutError:
                    # Send ping to keep connection alive
                    await self.ws.send(json.dumps({"event": "pusher:ping", "data": {}}))
                    
                except websockets.exceptions.ConnectionClosed:
                    logger.warning("⚠️ WebSocket connection closed")
                    break
                    
        except Exception as e:
            logger.error(f"Error listening to chat: {e}")
        finally:
            if self.on_disconnect_callback:
                self.on_disconnect_callback()
    
    async def process_message(self, raw_message: str):
        """Process incoming WebSocket message"""
        try:
            data = json.loads(raw_message)
            event = data.get('event')
            
            # Handle pong
            if event == 'pusher:pong':
                return
            
            # Handle chat messages
            if event == 'App\\Events\\ChatMessageEvent':
                message_data = json.loads(data.get('data', '{}'))
                
                username = message_data.get('sender', {}).get('username', 'Unknown')
                content = message_data.get('content', '')
                
                # Add to recent messages for context
                self.recent_messages.append({
                    'username': username,
                    'content': content,
                    'timestamp': time.time()
                })
                
                # Keep only recent messages
                if len(self.recent_messages) > self.max_context_messages:
                    self.recent_messages.pop(0)
                
                logger.info(f"💬 [{username}]: {content}")
                
                # Trigger callback if set
                if self.on_message_callback:
                    self.on_message_callback(username, content, message_data)
                
                # Add to queue for AI processing
                self.incoming_messages.put({
                    'username': username,
                    'content': content,
                    'data': message_data
                })
                
        except json.JSONDecodeError:
            logger.debug(f"Non-JSON message: {raw_message}")
        except Exception as e:
            logger.error(f"Error processing message: {e}")
    
    def should_respond(self, username: str, content: str) -> bool:
        """Determine if bot should respond to this message"""
        # Don't respond to own messages
        if username.lower() == 'your_bot_username':  # Replace with actual bot username
            return False
        
        # Rate limiting
        current_time = time.time()
        if current_time - self.last_response_time < self.min_response_interval:
            return False
        
        # Random chance to respond
        if random.random() > self.response_chance:
            return False
        
        # Don't respond to very short messages
        if len(content.strip()) < 3:
            return False
        
        return True
    
    async def send_message(self, message: str):
        """Send a message to Kick chat"""
        if not self.auth_token:
            logger.warning("⚠️ Cannot send message: no auth token provided")
            return False
        
        try:
            # Check if auth_token contains multiple tokens (newline separated)
            tokens = [t.strip() for t in str(self.auth_token).split('\n') if t.strip()]
            selected_token = random.choice(tokens) if tokens else self.auth_token

            import tls_client
            
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {selected_token}',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
            }
            
            payload = {
                'content': message,
                'type': 'message'
            }
            
            import asyncio
            
            def do_send():
                s = tls_client.Session(client_identifier="chrome_112", random_tls_extension_order=True)
                return s.post(
                    f'https://kick.com/api/v2/messages/send/{self.chatroom_id}',
                    headers=headers,
                    json=payload,
                    timeout_seconds=10
                )
            
            response = await asyncio.to_thread(do_send)
            
            if response.status_code == 200:
                logger.info(f"✅ Sent message: {message}")
                self.last_response_time = time.time()
                return True
            else:
                logger.error(f"Failed to send message: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return False
    
    def get_conversation_context(self) -> str:
        """Get recent conversation context for AI"""
        context = "Recent chat messages:\n"
        for msg in self.recent_messages[-5:]:  # Last 5 messages
            context += f"{msg['username']}: {msg['content']}\n"
        return context
    
    def start(self):
        """Start the chat bot in a background thread"""
        if self.running:
            logger.warning("Chat bot already running")
            return
        
        self.running = True
        thread = threading.Thread(target=self._run_async_loop, daemon=True)
        thread.start()
        logger.info("🚀 Kick chat bot started")
    
    def stop(self):
        """Stop the chat bot"""
        self.running = False
        logger.info("🛑 Kick chat bot stopped")
    
    def _run_async_loop(self):
        """Run the async event loop in a thread"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            loop.run_until_complete(self._run())
        except Exception as e:
            logger.error(f"Error in chat bot loop: {e}")
        finally:
            loop.close()
    
    async def _run(self):
        """Main async loop with auto-reconnect"""
        while self.running:
            try:
                if await self.connect_to_chat():
                    listen_task = asyncio.create_task(self.listen_to_chat())
                    auto_chat_task = asyncio.create_task(self.auto_chat_loop())
                    
                    # Wait for either task to complete (e.g. connection closed)
                    done, pending = await asyncio.wait(
                        [listen_task, auto_chat_task],
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    
                    # Cancel the pending task since the connection dropped
                    for task in pending:
                        task.cancel()
                        
                    logger.info("🔄 Reconnecting to Kick chat in 5 seconds...")
                    await asyncio.sleep(5)
                else:
                    await asyncio.sleep(5)
            except Exception as e:
                logger.error(f"Error in chat bot: {e}")
                await asyncio.sleep(5)

    async def auto_chat_loop(self):
        """Autonomous chat sending loop"""
        while self.running and self.ws:
            # Sleep for the configured interval plus some randomness to look human
            await asyncio.sleep(self.min_response_interval + random.uniform(0.5, 3.0))
            if self.on_auto_chat_callback:
                try:
                    await self.on_auto_chat_callback()
                except Exception as e:
                    logger.error(f"Error in auto chat callback: {e}")
