// public/js/chat.js
// Ephemeral real-time chat — adds to the existing `socket` from main.js.
// No new Socket.IO client. No database writes.

(function () {
    'use strict';

    // ── DOM refs (elements added in homepage.html) ──────────────────────────
    const chatPanel      = document.getElementById('chatPanel');
    const chatMessages   = document.getElementById('chatMessages');
    const chatInput      = document.getElementById('chatInput');
    const chatSendBtn    = document.getElementById('chatSendBtn');
    const chatToggleBtn  = document.getElementById('chatToggleBtn');
    const typingIndicator = document.getElementById('chatTyping');

    // Chat is only on the homepage — bail silently on other pages.
    if (!chatPanel) return;

    // ── Toggle panel open / closed ───────────────────────────────────────────
    let chatOpen = false;
    function toggleChat() {
        chatOpen = !chatOpen;
        chatPanel.classList.toggle('chat-panel--open', chatOpen);
        chatToggleBtn.classList.toggle('chat-toggle--active', chatOpen);
        if (chatOpen) {
            chatInput.focus();
            scrollToBottom();
        }
    }
    chatToggleBtn.addEventListener('click', toggleChat);

    // Close button inside the panel
    const chatCloseBtn = document.getElementById('chatCloseBtn');
    if (chatCloseBtn) {
        chatCloseBtn.addEventListener('click', () => {
            chatOpen = true; // force state so toggle flips it off
            toggleChat();
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function formatTime(ts) {
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function appendMessage({ username, message, timestamp, type = 'msg' }) {
        const el = document.createElement('div');

        if (type === 'system') {
            el.className = 'chat-msg chat-msg--system';
            el.textContent = message;
        } else {
            // Determine if this message belongs to the current user.
            const isSelf = window.currentUser && username === window.currentUser.username;
            el.className = 'chat-msg' + (isSelf ? ' chat-msg--self' : ' chat-msg--other');
            el.innerHTML =
                `<span class="chat-msg__name">${escapeHtml(username)}</span>` +
                `<span class="chat-msg__text">${escapeHtml(message)}</span>` +
                `<span class="chat-msg__time">${formatTime(timestamp)}</span>`;
        }

        chatMessages.appendChild(el);

        // Auto-scroll only when near the bottom (don't hijack a scroll-up view).
        const threshold = 60;
        const nearBottom =
            chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < threshold;
        if (nearBottom || type === 'msg') scrollToBottom();
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Typing indicator ─────────────────────────────────────────────────────
    let typingTimeout = null;

    function showTyping(username) {
        typingIndicator.textContent = `${username} is typing…`;
        typingIndicator.style.display = 'block';
    }

    function hideTyping() {
        typingIndicator.textContent = '';
        typingIndicator.style.display = 'none';
    }

    // ── Send message ─────────────────────────────────────────────────────────
    let isTypingEmitted = false;

    function sendMessage() {
        const msg = chatInput.value.trim();
        if (!msg) return;
        getSocket().emit('chat-message', { message: msg });
        chatInput.value = '';
        // Stop typing indicator.
        if (isTypingEmitted) {
            getSocket().emit('typing-stop');
            isTypingEmitted = false;
        }
    }

    chatSendBtn.addEventListener('click', sendMessage);

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Emit typing events.
    chatInput.addEventListener('input', () => {
        if (!isTypingEmitted) {
            getSocket().emit('typing-start');
            isTypingEmitted = true;
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            getSocket().emit('typing-stop');
            isTypingEmitted = false;
        }, 2000);
    });

    // ── Socket integration ───────────────────────────────────────────────────
    // `socket` is a global set by main.js. We need to wait until it exists and
    // is connected before registering listeners / joining a room.

    function getSocket() {
        // `socket` is declared in main.js (global scope).
        return window.socket || (typeof socket !== 'undefined' ? socket : null);
    }

    function bindSocketEvents(s) {
        // Incoming chat message.
        s.on('chat-message', (payload) => {
            appendMessage(payload);
        });

        // Another user joined.
        s.on('user-joined', ({ username, timestamp }) => {
            appendMessage({
                username,
                message: `${username} joined the room`,
                timestamp,
                type: 'system'
            });
        });

        // Another user left.
        s.on('user-left', ({ username, timestamp }) => {
            appendMessage({
                username,
                message: `${username} left the room`,
                timestamp,
                type: 'system'
            });
        });

        // Typing indicator from others.
        s.on('typing-start', ({ username }) => {
            showTyping(username);
            clearTimeout(typingTimeout);
        });

        s.on('typing-stop', () => {
            hideTyping();
        });

        // Error from server.
        s.on('chat-error', ({ message }) => {
            console.warn('[CHAT] Error:', message);
        });
    }

    function joinChatRoom(s) {
        const roomData = JSON.parse(localStorage.getItem('currentRoom') || 'null');
        if (!roomData?.roomCode) return;

        // Username is resolved from session on the server — we send only roomCode.
        s.emit('join-room', { roomCode: roomData.roomCode });
    }

    function initChat() {
        const s = getSocket();
        if (!s) {
            // main.js hasn't initialized socket yet — retry shortly.
            setTimeout(initChat, 300);
            return;
        }

        bindSocketEvents(s);

        if (s.connected) {
            joinChatRoom(s);
        } else {
            // Wait for the connect event that main.js will fire.
            s.on('connect', () => joinChatRoom(s));
        }
    }

    // Kick off after the DOM and main.js have had a chance to run.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        // Slight delay so initializeWebSocket() in main.js runs first.
        setTimeout(initChat, 1200);
    }

})();
