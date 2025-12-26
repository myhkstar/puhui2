
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export type AspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export type ComplexityLevel = 'Elementary' | 'High School' | 'College' | 'Expert';

export type VisualStyle = 'Default' | 'Minimalist' | 'Realistic' | 'Cartoon' | 'Vintage' | 'Futuristic' | '3D Render' | 'Sketch';

export type Language = 'English' | 'Spanish' | 'French' | 'German' | 'Mandarin' | 'Japanese' | 'Hindi' | 'Arabic' | 'Portuguese' | 'Russian' | 'Traditional Chinese';

export interface GeneratedImage {
  id: string;
  data: string; // Base64 data URL or R2 signed URL
  prompt: string;
  timestamp: number;
  level?: ComplexityLevel;
  style?: VisualStyle;
  language?: Language;
  aspectRatio?: AspectRatio;
  usage?: number;
  facts?: string[];
}

export interface SearchResultItem {
  title: string;
  url: string;
}

export interface ResearchResult {
  imagePrompt: string;
  facts: string[];
  searchResults: SearchResultItem[];
  usage?: number; // Total tokens used
}

// User System Types
export type UserRole = 'user' | 'admin' | 'vip';

export interface User {
  uid?: string; // Database ID
  username: string;
  password?: string; // Not stored in frontend
  role: UserRole;
  created_at: number;
  history: GeneratedImage[];
  displayName?: string;
  
  // New Fields
  contactEmail?: string; // Optional user provided email
  mobile?: string;       // Optional mobile number
  isApproved: boolean;   // Admin approval status
  expirationDate?: number; // Timestamp for account expiration
  tokens?: number;
  token?: string; // Auth token from login
  avatarUrl?: string;
}

export interface AuthState {
  currentUser: User | null;
  isAuthenticated: boolean;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
}

export interface UsageLog {
  feature: string;
  timestamp: number;
  tokenCount?: number;
}

export interface AdminUsageLog {
  username: string;
  feature: string;
  timestamp: number;
  tokenCount?: number;
}

// AI Service Responses
export interface AIResponse {
    content: string;
    usage: number;
}

// Properly extend the Window interface for the global scope
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
}
