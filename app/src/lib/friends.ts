/**
 * Friends API Service for Tauri Desktop App
 * Handles friend requests, listing, and ticket sharing
 */

import {
  createAuthTraceId,
  getCloudApiBaseUrl,
  getPersistentDeviceId,
  requestCloudApi,
} from "~/lib/cloud-api";

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

const API_BASE = getCloudApiBaseUrl();

class FriendsService {
  private createTraceId(action: string): string {
    return createAuthTraceId(`friends-${action}`);
  }

  /**
   * Get list of friends
   * @param status - Filter by status: 'accepted' | 'pending' | 'all'
   */
  async getFriends(
    status: "accepted" | "pending" | "all" = "accepted",
  ): Promise<Friend[]> {
    try {
      const traceId = this.createTraceId("list");
      const response = await requestCloudApi(
        `${API_BASE}/friends?status=${status}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
        { label: "friends.list", traceId },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Failed to fetch friends" }));
        throw new Error(error.error || "Failed to fetch friends");
      }

      const data = (await response.json()) as Friend[];
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
  async addFriend(
    email: string,
  ): Promise<{ success: boolean; action?: string; error?: string }> {
    try {
      const traceId = this.createTraceId("add");
      const response = await requestCloudApi(
        `${API_BASE}/friends`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        },
        { label: "friends.add", traceId },
      );

      const data = (await response.json()) as {
        error?: string;
        action?: string;
      };

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
      const traceId = this.createTraceId("remove");
      const response = await requestCloudApi(
        `${API_BASE}/friends/${friendUserId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
        },
        { label: "friends.remove", traceId },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Failed to remove friend" }));
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
    fileSize?: number,
  ): Promise<{ success: boolean }> {
    try {
      const traceId = this.createTraceId("ticket-friend");
      const response = await requestCloudApi(
        `${API_BASE}/tickets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Device-Id": getPersistentDeviceId(),
          },
          body: JSON.stringify({
            friendUserId,
            ticket,
            filename,
            fileSize,
          }),
        },
        { label: "tickets.send-friend", traceId },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Failed to send ticket" }));
        throw new Error(error.error || "Failed to send ticket");
      }

      return { success: true };
    } catch (error) {
      console.error("[FriendsService] sendTicketToFriend error:", error);
      throw error;
    }
  }

  /**
   * Send a ticket to one of the user's own devices
   * @param deviceId - The target device ID
   * @param ticket - The transfer ticket
   * @param filename - Optional filename
   */
  async sendTicketToDevice(
    deviceId: string,
    ticket: string,
    filename?: string,
    fileSize?: number,
  ): Promise<{ success: boolean }> {
    try {
      const traceId = this.createTraceId("ticket-device");
      const response = await requestCloudApi(
        `${API_BASE}/tickets`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Device-Id": getPersistentDeviceId(),
          },
          body: JSON.stringify({
            deviceId,
            ticket,
            filename,
            fileSize,
          }),
        },
        { label: "tickets.send-device", traceId },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Failed to send ticket" }));
        throw new Error(error.error || "Failed to send ticket to device");
      }

      return { success: true };
    } catch (error) {
      console.error("[FriendsService] sendTicketToDevice error:", error);
      throw error;
    }
  }

  /**
   * Get tickets shared with the user
   */
  async getSharedTickets(): Promise<
    Array<{
      id: string;
      ticket: string;
      filename: string | null;
      senderName: string;
      createdAt: Date;
    }>
  > {
    try {
      const traceId = this.createTraceId("tickets-list");
      const response = await requestCloudApi(
        `${API_BASE}/tickets?deviceId=${encodeURIComponent(getPersistentDeviceId())}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Device-Id": getPersistentDeviceId(),
          },
        },
        { label: "tickets.list", traceId },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Failed to fetch tickets" }));
        throw new Error(error.error || "Failed to fetch tickets");
      }

      const data = (await response.json()) as Array<{
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
      const traceId = this.createTraceId("ticket-receive");
      await requestCloudApi(
        `${API_BASE}/tickets/${ticketId}/receive`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Device-Id": getPersistentDeviceId(),
          },
        },
        { label: "tickets.receive", traceId },
      );
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
