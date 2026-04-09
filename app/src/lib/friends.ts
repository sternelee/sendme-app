/**
 * Friends API Service for Tauri Desktop App
 * Handles friend requests, listing, and ticket sharing
 */

import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

export interface FriendDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  lastSeenAt: Date;
}

export interface Friend {
  id: string;
  userId: string;
  friendUserId: string;
  status: "pending" | "accepted";
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  friend: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  friendDevices: FriendDevice[];
}

const API_BASE = "/api";

class FriendsService {
  /**
   * Get auth token for API requests using tauri-plugin-clerk
   */
  private async getAuthHeader(): Promise<HeadersInit> {
    try {
      const token = await invoke<string | null>("plugin:clerk|get_client_authorization_header");
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch (error) {
      console.error("[FriendsService] Failed to get token:", error);
      return {};
    }
  }

  /**
   * Get list of friends
   * @param status - Filter by status: 'accepted' | 'pending' | 'all'
   */
  async getFriends(status: "accepted" | "pending" | "all" = "accepted"): Promise<Friend[]> {
    try {
      const headers = await this.getAuthHeader();
      const response = await fetch(`${API_BASE}/friends?status=${status}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to fetch friends" }));
        throw new Error(error.error || "Failed to fetch friends");
      }

      const data = await response.json() as Friend[];
      return data;
    } catch (error) {
      console.error("[FriendsService] getFriends error:", error);
      throw error;
    }
  }

  /**
   * Send a friend request or accept an existing one
   * @param email - The email of the user to add/accept
   */
  async addFriend(email: string): Promise<{ success: boolean; action?: string; error?: string }> {
    try {
      const headers = await this.getAuthHeader();
      const response = await fetch(`${API_BASE}/friends`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json() as { error?: string; action?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to add friend");
      }

      return { success: true, action: data.action };
    } catch (error) {
      console.error("[FriendsService] addFriend error:", error);
      throw error;
    }
  }

  /**
   * Remove a friend or decline a friend request
   * @param friendUserId - The user ID of the friend to remove
   */
  async removeFriend(friendUserId: string): Promise<void> {
    try {
      const headers = await this.getAuthHeader();
      const response = await fetch(`${API_BASE}/friends/${friendUserId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to remove friend" }));
        throw new Error(error.error || "Failed to remove friend");
      }
    } catch (error) {
      console.error("[FriendsService] removeFriend error:", error);
      throw error;
    }
  }

  /**
   * Send a ticket to a friend
   * @param friendUserId - The user ID of the friend to send to
   * @param ticket - The transfer ticket
   * @param filename - Optional filename
   */
  async sendTicketToFriend(
    friendUserId: string,
    ticket: string,
    filename?: string,
  ): Promise<{ success: boolean }> {
    try {
      const headers = await this.getAuthHeader();
      const response = await fetch(`${API_BASE}/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          friend_user_id: friendUserId,
          ticket,
          filename,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to send ticket" }));
        throw new Error(error.error || "Failed to send ticket");
      }

      return { success: true };
    } catch (error) {
      console.error("[FriendsService] sendTicketToFriend error:", error);
      throw error;
    }
  }

  /**
   * Get tickets shared with the user
   */
  async getSharedTickets(): Promise<Array<{
    id: string;
    ticket: string;
    filename: string | null;
    senderName: string;
    createdAt: Date;
  }>> {
    try {
      const headers = await this.getAuthHeader();
      const response = await fetch(`${API_BASE}/tickets`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to fetch tickets" }));
        throw new Error(error.error || "Failed to fetch tickets");
      }

      const data = await response.json() as Array<{
        id: string;
        ticket: string;
        filename: string | null;
        senderName: string;
        createdAt: Date;
      }>;
      return data;
    } catch (error) {
      console.error("[FriendsService] getSharedTickets error:", error);
      throw error;
    }
  }

  /**
   * Mark a ticket as received
   */
  async markTicketReceived(ticketId: string): Promise<void> {
    try {
      const headers = await this.getAuthHeader();
      await fetch(`${API_BASE}/tickets/${ticketId}/receive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });
    } catch (error) {
      console.error("[FriendsService] markTicketReceived error:", error);
    }
  }
}

// Singleton instance
let friendsServiceInstance: FriendsService | null = null;

export function useFriends(): FriendsService {
  if (!friendsServiceInstance) {
    friendsServiceInstance = new FriendsService();
  }
  return friendsServiceInstance;
}

export { FriendsService };