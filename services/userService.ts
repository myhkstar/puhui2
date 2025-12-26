/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { User, GeneratedImage, UserRole, ChatSession, ChatMessage, UsageLog, AdminUsageLog } from "../types";

const API_BASE = '/api';

const getHeaders = () => {
  const token = localStorage.getItem('vision_token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
};

export const userService = {
    // 監聽登入狀態 (Simulation using checkSession)
    onAuthStateChanged: (callback: (user: User | null) => void) => {
        // Immediate check
        userService.checkSession().then(callback);
        
        // Return a dummy unsubscribe function
        return () => {};
    },

    checkSession: async (): Promise<User | null> => {
        const token = localStorage.getItem('vision_token');
        if (!token) return null;

        try {
            const res = await fetch(`${API_BASE}/auth/me`, {
                headers: getHeaders()
            });
            if (res.ok) {
                const userData = await res.json();
                
                // Fetch history separately
                let history: GeneratedImage[] = [];
                try {
                    const histRes = await fetch(`${API_BASE}/images`, { headers: getHeaders() });
                    if (histRes.ok) history = await histRes.json();
                } catch (e) {
                    console.warn("Could not fetch history", e);
                }

                return { ...userData, history };
            } else {
                localStorage.removeItem('vision_token');
                return null;
            }
        } catch (e) {
            console.error("Session check failed", e);
            return null;
        }
    },

    login: async (username: string, password: string): Promise<User> => {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.message || 'Login failed');
        }

        if (data.token) {
            localStorage.setItem('vision_token', data.token);
        }

        // Fetch history
        let history: GeneratedImage[] = [];
        try {
            const histRes = await fetch(`${API_BASE}/images`, { headers: getHeaders() });
            if (histRes.ok) history = await histRes.json();
        } catch (e) {}

        return { ...data, history };
    },

    register: async (
        username: string, 
        password: string, 
        displayName: string, 
        contactEmail?: string, 
        mobile?: string
    ): Promise<{ success: boolean; message: string }> => {
        try {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, displayName, contactEmail, mobile })
            });
            const data = await res.json();
            
            if (!res.ok) {
                return { success: false, message: data.message || 'Registration failed' };
            }
            return { success: true, message: data.message };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    },

    logout: async () => {
        localStorage.removeItem('vision_token');
    },

    saveUserImage: async (user: User, image: GeneratedImage) => {
        try {
            const res = await fetch(`${API_BASE}/images`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(image)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to save image");
            }
            
            const data = await res.json();
            // Return updated image object with the R2 URL
            return { ...image, data: data.url };
        } catch (e) {
            console.error("Error saving image:", e);
            throw e;
        }
    },

    // --- Usage Logs ---
    logUsage: async (feature: string, tokenCount: number = 0): Promise<{ remainingTokens?: number }> => {
        try {
            const res = await fetch(`${API_BASE}/usage`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ feature, tokenCount }),
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.error("Log usage failed", e);
        }
        return {};
    },

    saveGeneratedImage: async (image: { id: string, data: string, prompt: string, timestamp: number }) => {
        try {
            const res = await fetch(`${API_BASE}/generated-images`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(image)
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to save generated image");
            }
        } catch (e) {
            console.error("Error saving generated image:", e);
            // Don't throw here to avoid breaking UI flow
        }
    },

    getMyUsage: async (): Promise<UsageLog[]> => {
        try {
            const res = await fetch(`${API_BASE}/usage/me`, { headers: getHeaders() });
            if (res.ok) return await res.json();
            return [];
        } catch (e) { return []; }
    },

    getAllUsage: async (): Promise<AdminUsageLog[]> => {
        try {
            const res = await fetch(`${API_BASE}/admin/usage`, { headers: getHeaders() });
            if (res.ok) return await res.json();
            return [];
        } catch (e) { return []; }
    },

    // --- Chat System ---
    createChatSession: async (id: string, title: string) => {
        const res = await fetch(`${API_BASE}/chat/sessions`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ id, title, created_at: Date.now() })
        });
        if (!res.ok) throw new Error("Failed to create chat session");
    },

    getChatSessions: async (): Promise<ChatSession[]> => {
        const res = await fetch(`${API_BASE}/chat/sessions`, { headers: getHeaders() });
        if (res.ok) return await res.json();
        return [];
    },

    deleteChatSession: async (id: string) => {
        await fetch(`${API_BASE}/chat/sessions/${id}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
    },

    saveChatMessage: async (sessionId: string, role: string, content: string) => {
        const res = await fetch(`${API_BASE}/chat/messages`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ session_id: sessionId, role, content, created_at: Date.now() })
        });
        if (!res.ok) throw new Error("Failed to save message");
    },

    getChatMessages: async (sessionId: string): Promise<ChatMessage[]> => {
        const res = await fetch(`${API_BASE}/chat/messages/${sessionId}`, { headers: getHeaders() });
        if (res.ok) return await res.json();
        return [];
    },

    updateChatSessionTitle: async (id: string, title: string) => {
        await fetch(`${API_BASE}/chat/sessions/${id}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ title })
        });
    },

    // --- Admin Functions ---

    getAllUsers: async (): Promise<User[]> => {
        try {
            const res = await fetch(`${API_BASE}/admin/users`, { headers: getHeaders() });
            if (res.ok) return await res.json();
            return [];
        } catch (e) {
            console.error("Error fetching users", e);
            return [];
        }
    },

    updateUser: async (uid: string, data: Partial<User>) => {
        await fetch(`${API_BASE}/admin/users/${uid}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
    },

    updateUserProfile: async (data: { displayName: string, contactEmail: string, mobile: string }) => {
        const res = await fetch(`${API_BASE}/user/profile`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message);
        }
        return await res.json();
    },

    changePassword: async (data: { currentPassword: string, newPassword: string }) => {
        const res = await fetch(`${API_BASE}/user/password`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message);
        }
        return await res.json();
    },

    getAvatarUploadUrl: async (fileName: string, fileType: string) => {
        const res = await fetch(`${API_BASE}/user/avatar-upload-url`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ fileName, fileType })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message);
        }
        return await res.json();
    },

    deleteUser: async (uid: string) => {
        await fetch(`${API_BASE}/admin/users/${uid}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
    },

    createUserByAdmin: async (username: string, password: string, displayName: string, role: UserRole) => {
        try {
            const res = await fetch(`${API_BASE}/admin/users`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ username, password, displayName, role })
            });
            const data = await res.json();
            if (!res.ok) return { success: false, message: data.message };
            return { success: true, message: 'User created' };
        } catch (e: any) {
             return { success: false, message: e.message };
        }
    }
};
