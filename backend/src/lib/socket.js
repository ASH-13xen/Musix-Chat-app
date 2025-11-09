import { Server } from "socket.io";
import { Message } from "../models/message.model.js";

export const initializeSocket = (server) => {
  // Use a production-ready CORS configuration when deploying
  // For now, keeping localhost as per your original code:
  const io = new Server(server, {
    cors: {
      origin: "http://localhost:3000",
      credentials: true,
    },
  });

  const userSockets = new Map(); // { clerkId: socketId}
  const userActivities = new Map(); // {clerkId: activity}

  io.on("connection", (socket) => {
    // 1. New user connection
    socket.on("user_connected", (clerkId) => {
      // Store user ID against their socket ID
      userSockets.set(clerkId, socket.id);
      userActivities.set(clerkId, "Online"); // Default to 'Online' upon connection

      // Broadcast to ALL users the list of currently online users
      io.emit("users_online", Array.from(userSockets.keys()));
      console.log(
        `User connected: ${clerkId}. Total users online: ${userSockets.size}`
      );
    });

    // 2. Activity update
    socket.on("update_activity", ({ clerkId, activity }) => {
      userActivities.set(clerkId, activity);
      // Broadcast activity update to all users
      io.emit("activity_updated", { clerkId, activity });
    });

    // 3. Send Message handler
    socket.on("send_message", async (data) => {
      try {
        const { senderId, receiverId, content } = data;

        const message = await Message.create({
          senderId,
          receiverId,
          content,
        });

        // Get the recipient's socket ID
        const receiverSocketId = userSockets.get(receiverId);

        // Send the new message to the RECEIVER in real-time (if online)
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("receive_message", message);
        }

        // Send the new message back to the SENDER'S socket for immediate UI update
        // We use the sender's current socket ID, which we can look up from userSockets map
        const senderSocketId = userSockets.get(senderId);
        if (senderSocketId) {
          // Note: io.to(socket.id).emit(...) is essentially what socket.emit(...) does,
          // but for clarity, we can emit it back to the sender if needed,
          // or trust the sender's client-side code to append the message instantly.
          // For robust multi-tab support, we emit to the sender's socket ID.
          io.to(senderSocketId).emit("receive_message", message);
        }
      } catch (error) {
        console.error("Message error:", error);
        socket.emit("message_error", error.message);
      }
    });

    // 4. Disconnect handler
    socket.on("disconnect", () => {
      let disconnectedUserId;
      // Find the user associated with the disconnected socket ID
      for (const [userId, socketId] of userSockets.entries()) {
        if (socketId === socket.id) {
          disconnectedUserId = userId;
          userSockets.delete(userId);
          userActivities.delete(userId);
          break;
        }
      }
      if (disconnectedUserId) {
        // Broadcast to ALL users that this user is now disconnected
        io.emit("user_disconnected", disconnectedUserId);
        io.emit("users_online", Array.from(userSockets.keys())); // Send updated list
      }
    });
  });
};
