import { axiosInstance } from "@/lib/axios";
import type { Message, User } from "@/types";
import { create } from "zustand";
import { io } from "socket.io-client";

interface ChatStore {
  users: User[];
  isLoading: boolean;
  error: string | null;
  socket: any;
  isConnected: boolean;
  onlineUsers: Set<string>;
  userActivities: Map<string, string>;
  messages: Message[];
  selectedUser: User | null;

  fetchUsers: () => Promise<void>;
  initSocket: (userId: string) => void;
  disconnectSocket: () => void;
  sendMessage: (receiverId: string, senderId: string, content: string) => void;
  fetchMessages: (userId: string) => Promise<void>;
  setSelectedUser: (user: User | null) => void;
}

const baseURL =
  import.meta.env.MODE === "development" ? "http://localhost:5000" : "/";

const socket = io(baseURL, {
  autoConnect: false, // only connect if user is authenticated
  withCredentials: true,
});

export const useChatStore = create<ChatStore>((set, get) => ({
  users: [],
  isLoading: false,
  error: null,
  socket: socket,
  isConnected: false,
  onlineUsers: new Set(),
  userActivities: new Map(),
  messages: [],
  selectedUser: null,

  setSelectedUser: (user) => {
    // When a user is selected, also clear old messages to ensure we fetch fresh ones
    set({ selectedUser: user, messages: [] });
  },

  fetchUsers: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await axiosInstance.get("/users");
      set({ users: response.data });
    } catch (error: any) {
      set({ error: error.response.data.message });
    } finally {
      set({ isLoading: false });
    }
  },

  initSocket: (userId) => {
    if (!get().isConnected) {
      socket.auth = { userId };
      socket.connect();

      socket.emit("user_connected", userId);

      socket.on("users_online", (users: string[]) => {
        set({ onlineUsers: new Set(users) });
      });

      // --- Socket Listeners for Real-time Updates ---

      // Note: We only need 'receive_message', as the server is configured
      // to send this event to both the sender and the receiver now.
      socket.on("receive_message", (message: Message) => {
        const { selectedUser } = get();
        const currentUserId = userId; // The ID of the currently authenticated user

        // Check if the message is for the currently selected chat
        const isFromSelectedUser = message.senderId === selectedUser?.clerkId;
        const isToSelectedUser = message.receiverId === selectedUser?.clerkId;

        // Ensure the message is actually part of the conversation with the selected user
        if (
          (isFromSelectedUser && message.receiverId === currentUserId) ||
          (isToSelectedUser && message.senderId === currentUserId)
        ) {
          set((state) => ({
            messages: [...state.messages, message],
          }));
        }
      });

      // Removed redundant 'message_sent' listener, as 'receive_message' now handles it.

      socket.on("activities", (activities: [string, string][]) => {
        set({ userActivities: new Map(activities) });
      });

      socket.on("user_connected", (userId: string) => {
        set((state) => ({
          onlineUsers: new Set([...state.onlineUsers, userId]),
        }));
      });

      socket.on("user_disconnected", (userId: string) => {
        set((state) => {
          const newOnlineUsers = new Set(state.onlineUsers);
          newOnlineUsers.delete(userId);
          return { onlineUsers: newOnlineUsers };
        });
      });

      socket.on("activity_updated", ({ userId: updatedUserId, activity }) => {
        set((state) => {
          const newActivities = new Map(state.userActivities);
          newActivities.set(updatedUserId, activity);
          return { userActivities: newActivities };
        });
      });

      set({ isConnected: true });
    }
  },

  disconnectSocket: () => {
    if (get().isConnected) {
      socket.disconnect();
      set({ isConnected: false });
    }
  },

  sendMessage: async (receiverId, senderId, content) => {
    const socket = get().socket;
    if (!socket || !content.trim()) return; // Added trim check for empty messages

    socket.emit("send_message", { receiverId, senderId, content });
  },

  fetchMessages: async (userId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await axiosInstance.get(`/users/messages/${userId}`);
      set({ messages: response.data });
    } catch (error: any) {
      // It's common to get a 404/empty array if no messages exist, so handle the error gracefully
      console.error("Error fetching messages:", error);
      set({ messages: [] });
    } finally {
      set({ isLoading: false });
    }
  },
}));
