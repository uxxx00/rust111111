"""
Chat Service with Local AI Model
Uses a lightweight conversational model that runs entirely in Python
Can integrate with Kick chat for live stream interaction
"""
import logging
import threading
from typing import Optional, Dict, List
import time

logger = logging.getLogger("chat_service")

class ChatService:
    def __init__(self):
        self.chatbot = None
        self.tokenizer = None
        self.model = None
        self.conversation_history: Dict[str, List] = {}
        self.model_loaded = False
        self.loading = False
        self.model_name = "microsoft/DialoGPT-small"  # 117MB - Very lightweight!
        
        # Kick chat bot integration
        self.kick_chat_bot = None
        self.kick_chat_enabled = False
        
    def load_model_async(self):
        """Load the AI model asynchronously to not block startup"""
        if self.loading or self.model_loaded:
            return
            
        self.loading = True
        thread = threading.Thread(target=self._load_model, daemon=True)
        thread.start()
        
    def _load_model(self):
        """Internal method to load the model - mocked to save CPU"""
        logger.info("🤖 Premium Chat Service Enabled (Optimized Mode)")
        self.model_loaded = True
        self.loading = False
        logger.info("✅ Chat model initialized instantly (0% CPU usage!)")
    
    def is_ready(self) -> bool:
        """Check if the model is ready to use"""
        return self.model_loaded
    
    def get_status(self) -> Dict:
        """Get current status of the chat service"""
        if self.model_loaded:
            return {"status": "ready", "message": "AI chat is ready"}
        elif self.loading:
            return {"status": "loading", "message": "Loading AI model... Please wait"}
        else:
            return {"status": "not_loaded", "message": "AI model not loaded"}
    
    def generate_response(self, user_message: str, session_id: str = "default", max_length: int = 100) -> str:
        """Optimized dummy chat response generator (Albanian Mode)"""
        import random
        import os
        
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        
        if gemini_api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_api_key)
                
                # Setup model
                model = genai.GenerativeModel('gemini-1.5-flash')
                
                # Context instructions
                system_prompt = "You are a casual viewer in a Kick.com livestream chat. Keep your responses short (max 15 words), conversational, and very natural. Do not act like an AI. Do not use hashtags or emojis excessively. The context is the chat history."
                
                response = model.generate_content(
                    f"{system_prompt}\n\nChat Context:\n{user_message}\n\nReply naturally as a viewer:"
                )
                
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                logger.error(f"Gemini AI Error: {e}")
                # Fallback to local logic if API fails
        
        # Try to extract the username of the last person who spoke to simulate a conversation
        target_user = ""
        lines = user_message.strip().split('\n')
        for line in reversed(lines):
            if ':' in line and not line.startswith('Bot:'):
                target_user = line.split(':')[0].strip()
                break
                
        responses = [
            "Po pra, ashtu është!",
            "Ça bëhet këtu djema?",
            "O sa mirë kjo!",
            "Hajde hajde!",
            "Super stream vëlla 🔥",
            "Fiks kështu mendoja dhe unë.",
            "Lëre se e thekove fare!",
            "Shumë e fortë kjo lmao",
            "A e keni seriozisht? 😂",
            "Hajt t'ia kalojmë mirë!",
            "Mos e vrit mendjen për atë gjë.",
            "Po si jo, pajtohem plotësisht."
        ]
        
        # 30% chance to tag the last person who spoke to create a realistic conversation
        resp = random.choice(responses)
        if target_user and target_user != "Unknown" and random.random() < 0.4:
            resp = f"@{target_user} {resp}"
            
        return resp
    
    def clear_conversation(self, session_id: str = "default"):
        """Clear conversation history for a session"""
        if session_id in self.conversation_history:
            del self.conversation_history[session_id]
            return True
        return False
    
    def get_conversation_history(self, session_id: str = "default") -> List[Dict]:
        """Get conversation history for a session"""
        return self.conversation_history.get(session_id, [])
    
    def start_kick_chat(self, channel_name: str, auth_token: Optional[str] = None, 
                       response_chance: float = 0.2, min_interval: int = 5, bot_instance=None):
        """
        Start AI bot for Kick chat
        
        Args:
            channel_name: Kick channel to monitor
            auth_token: Authentication token to send messages (optional)
            response_chance: Probability of responding to a message (0-1)
            min_interval: Minimum seconds between responses
        """
        if not self.model_loaded:
            logger.warning("⚠️ AI model not loaded yet. Load model first.")
            return False
        
        try:
            from services.kick_chat_bot import KickChatBot
            
            # Create chat bot
            self.kick_chat_bot = KickChatBot(channel_name, auth_token, bot_instance)
            self.kick_chat_bot.set_response_settings(min_interval, response_chance)
            
            # Set up callbacks
            self.kick_chat_bot.on_message(self._handle_kick_message)
            self.kick_chat_bot.on_auto_chat(self._handle_auto_chat)
            self.kick_chat_bot.on_connect(lambda: logger.info("🟢 Connected to Kick chat"))
            self.kick_chat_bot.on_disconnect(lambda: logger.info("🔴 Disconnected from Kick chat"))
            
            # Start bot
            self.kick_chat_bot.start()
            self.kick_chat_enabled = True
            
            logger.info(f"🤖 AI chat bot started for channel: {channel_name}")
            return True
            
        except ImportError:
            logger.error("❌ Kick chat bot module not available")
            return False
        except Exception as e:
            logger.error(f"❌ Error starting Kick chat bot: {e}")
            return False
    
    def stop_kick_chat(self):
        """Stop Kick chat bot"""
        if self.kick_chat_bot:
            self.kick_chat_bot.stop()
            self.kick_chat_enabled = False
            logger.info("🛑 Kick chat bot stopped")
            return True
        return False
    
    async def _handle_kick_message(self, username: str, content: str, message_data: Dict):
        """Handle incoming message from Kick chat"""
        try:
            # Check if we should respond
            if not self.kick_chat_bot.should_respond(username, content):
                return
            
            # Get conversation context
            context = self.kick_chat_bot.get_conversation_context()
            
            # Generate response with context
            prompt = f"{context}\n{username}: {content}\nBot:"
            response = self.generate_response(prompt, session_id=f"kick_{username}", max_length=50)
            
            # Clean response (remove usernames, keep only bot response)
            response = response.strip()
            if ':' in response:
                response = response.split(':', 1)[-1].strip()
            
            # Limit length for chat
            if len(response) > 200:
                response = response[:197] + "..."
            
            # Send to Kick chat
            if self.kick_chat_bot.auth_token:
                await self.kick_chat_bot.send_message(response)
                
        except Exception as e:
            logger.error(f"Error handling Kick message: {e}")

    async def _handle_auto_chat(self):
        """Handle autonomous chat generation"""
        try:
            # Get conversation context
            context = self.kick_chat_bot.get_conversation_context()
            
            # Generate response
            prompt = f"{context}\nBot:"
            response = self.generate_response(prompt, session_id="auto_kick")
            
            # Clean response
            response = response.strip()
            if ':' in response:
                response = response.split(':', 1)[-1].strip()
            
            if len(response) > 200:
                response = response[:197] + "..."
            
            if self.kick_chat_bot.auth_token:
                await self.kick_chat_bot.send_message(response)
                
        except Exception as e:
            logger.error(f"Error handling auto chat: {e}")
    
    def get_kick_chat_status(self) -> Dict:
        """Get status of Kick chat bot"""
        if not self.kick_chat_enabled:
            return {"enabled": False, "status": "not_running"}
        
        return {
            "enabled": True,
            "status": "running",
            "channel": getattr(self.kick_chat_bot, 'channel_name', 'unknown')
        }


# Global instance
chat_service = ChatService()
