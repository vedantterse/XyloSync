// server/chat.js

export function initializeChat(io, socket) {

    console.log(`[CHAT] Socket connected: ${socket.id}`);

    /**
     * Join a chat room
     */
    socket.on("join-room", ({ roomCode }) => {

        // Use the authenticated session username — never trust client input for identity.
        const username = socket.user?.username;

        if (!roomCode || !username) {
            socket.emit("chat-error", {
                message: "Invalid room or username."
            });
            return;
        }

        socket.join(roomCode);

        socket.data.roomCode = roomCode;
        socket.data.username = username;

        console.log(
            `[CHAT] ${username} joined room ${roomCode}`
        );

        socket.emit("joined-room", {
            success: true,
            roomCode
        });

        io.to(roomCode).emit("user-joined", {
            username,
            timestamp: Date.now()
        });

    });

    /**
     * Receive chat message
     */
    socket.on("chat-message", ({ message }) => {

        const roomCode = socket.data.roomCode;
        const username = socket.data.username;

        if (!roomCode || !username) {
            socket.emit("chat-error", {
                message: "You are not in a room."
            });
            return;
        }

        if (!message || !message.trim()) {
            return;
        }

        const payload = {

            username,

            message: message.trim(),

            timestamp: Date.now()

        };

        io.to(roomCode).emit(
            "chat-message",
            payload
        );

        console.log(
            `[CHAT] [${roomCode}] ${username}: ${message}`
        );

    });

    /**
     * Typing indicator
     */
    socket.on("typing-start", () => {

        const roomCode = socket.data.roomCode;

        if (!roomCode) return;

        socket.to(roomCode).emit(
            "typing-start",
            {
                username: socket.data.username
            }
        );

    });

    socket.on("typing-stop", () => {

        const roomCode = socket.data.roomCode;

        if (!roomCode) return;

        socket.to(roomCode).emit(
            "typing-stop",
            {
                username: socket.data.username
            }
        );

    });

    /**
     * Leave room manually
     */
    socket.on("leave-room", () => {

        const roomCode = socket.data.roomCode;
        const username = socket.data.username;

        if (!roomCode) return;

        socket.leave(roomCode);

        io.to(roomCode).emit(
            "user-left",
            {
                username,
                timestamp: Date.now()
            }
        );

        console.log(
            `[CHAT] ${username} left room ${roomCode}`
        );

        socket.data.roomCode = null;
        socket.data.username = null;

    });

    /**
     * Cleanup
     */
    socket.on("disconnect", () => {

        const roomCode = socket.data.roomCode;
        const username = socket.data.username;

        if (roomCode && username) {

            io.to(roomCode).emit(
                "user-left",
                {
                    username,
                    timestamp: Date.now()
                }
            );

            console.log(
                `[CHAT] ${username} disconnected`
            );

        }

    });

}