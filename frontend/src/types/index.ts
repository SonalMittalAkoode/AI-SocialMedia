export type SocialPlatform = "Instagram" | "Facebook" | "LinkedIn" | "X";
export interface User {
  id?: string;
  name: string;
  email: string;
  isActive?: boolean;
  isVerified?: boolean;
  createdAt?: string;
}
export interface BrandIdentity {
  tones: string[];
  colors: string[];
  logo: string;
}
export interface CompanyProfile {
  name: string;
  website: string;
  industry: string;
  description: string;
  location: string;
  audience: string;
  services: string;
  socialLinks: string;
  guidelines: string;
  identity: BrandIdentity;
}
export interface Workspace {
  id: string;
  name: string;
  company: CompanyProfile;
}
export interface Competitor {
  id: string;
  name: string;
  initials: string;
  category: string;
  description: string;
  themes: string[];
  relevance: string;
  color: string;
}
export interface ContentPreferences {
  platforms: SocialPlatform[];
  goals: string[];
  tones: string[];
  formats: string[];
  frequency: string;
  customFrequency: number;
  language: string;
  instructions: string;
}
export interface GeneratedPost {
  id: string;
  title: string;
  caption: string;
  hashtags: string;
  platform: SocialPlatform;
  category: string;
  status: "Draft" | "Scheduled" | "Published";
  creative: number;
  updatedAt: string;
  scheduledAt?: string;
}
export interface ScheduledPost extends GeneratedPost {
  scheduledAt: string;
}
export interface AnalyticsData {
  label: string;
  generated: number;
  engagement: number;
}
export interface OnboardingProgress {
  step: number;
  currentStep?: number;
  completed: boolean;
}
export interface DemoState {
  user: User | null;
  authenticated: boolean;
  rememberSession: boolean;
  workspace: Workspace;
  onboarding: OnboardingProgress;
  preferences: ContentPreferences;
  competitorIds: string[];
  customCompetitors: Competitor[];
  posts: GeneratedPost[];
  notifications: boolean;
}
