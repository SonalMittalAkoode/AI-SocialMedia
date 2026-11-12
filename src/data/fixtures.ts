import {
  AnalyticsData,
  CompanyProfile,
  Competitor,
  ContentPreferences,
  DemoState,
  GeneratedPost,
  SocialPlatform,
} from "@/types";
export const platforms: SocialPlatform[] = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "X",
];
export const company: CompanyProfile = {
  name: "Brew & Bean",
  website: "https://brewandbean.example",
  industry: "Food & Beverage",
  description:
    "A modern neighborhood cafe serving specialty coffee, fresh pastries, and handcrafted beverages.",
  location: "Gurgaon, India",
  audience:
    "Students, working professionals, coffee lovers, and remote workers",
  services:
    "Specialty Coffee, Fresh Pastries, Dine-In, Takeaway, Workspace-Friendly Seating",
  socialLinks: "",
  guidelines:
    "Warm, thoughtful content. Celebrate our community and the everyday ritual of good coffee.",
  identity: {
    tones: ["Friendly", "Premium"],
    colors: ["#795038", "#f5ead8", "#b9a48a"],
    logo: "",
  },
};
export const competitors: Competitor[] = [
  {
    id: "urban",
    name: "Urban Coffee Co.",
    initials: "uc",
    category: "Specialty coffee",
    description: "A design-led coffee spot with a focus on everyday rituals.",
    themes: ["Lifestyle", "Behind the scenes", "Morning rituals"],
    relevance: "High",
    color: "#b1bca3",
  },
  {
    id: "daily",
    name: "The Daily Brew",
    initials: "db",
    category: "Coffee and coworking",
    description:
      "Coffee, productive mornings, and a place to make things happen.",
    themes: ["Productivity", "Cafe culture", "Remote work"],
    relevance: "High",
    color: "#d9b99b",
  },
  {
    id: "corner",
    name: "Cafe Corner",
    initials: "cc",
    category: "Coffee and bakery",
    description: "Small-batch bakes and seasonal menus for the neighborhood.",
    themes: ["Food photography", "Seasonal menus", "Promotions"],
    relevance: "Medium",
    color: "#c4adc8",
  },
  {
    id: "bean",
    name: "Bean Street",
    initials: "bs",
    category: "Artisan coffee",
    description: "An independent roastery sharing the people behind every cup.",
    themes: ["Community", "Storytelling", "Coffee education"],
    relevance: "High",
    color: "#a6b5cd",
  },
];
export const preferences: ContentPreferences = {
  platforms: ["Instagram", "LinkedIn"],
  goals: ["Brand Awareness", "Audience Engagement"],
  tones: ["Friendly"],
  formats: ["Image Posts"],
  frequency: "3 posts/week",
  customFrequency: 4,
  language: "English",
  instructions: "",
};
export const posts: GeneratedPost[] = [
  {
    id: "morning",
    title: "Your morning, made better.",
    caption:
      "A little pause. A perfectly pulled espresso. A fresh start. Your morning ritual is waiting at Brew & Bean. ☕ What’s your go-to order?",
    hashtags: "#BrewAndBean #MorningRitual #SpecialtyCoffee",
    platform: "Instagram",
    category: "Lifestyle",
    status: "Draft",
    creative: 0,
    updatedAt: "2026-11-11T08:00:00",
  },
  {
    id: "weekend",
    title: "Slow weekends. Great coffee.",
    caption:
      "Leave the rush at the door. Find your favorite corner, order something delicious, and let the weekend unfold. See you at Brew & Bean.",
    hashtags: "#WeekendMood #CafeCulture #BrewAndBean",
    platform: "Facebook",
    category: "Community",
    status: "Scheduled",
    creative: 1,
    updatedAt: "2026-11-10T10:00:00",
    scheduledAt: "2026-11-14T10:00",
  },
  {
    id: "workspace",
    title: "A change of workspace.",
    caption:
      "Big ideas deserve a good setting. Bring your laptop, find a comfortable seat, and fuel your next chapter with handcrafted coffee.",
    hashtags: "#WorkFromCafe #CreativeCommunity #BrewAndBean",
    platform: "LinkedIn",
    category: "Educational",
    status: "Published",
    creative: 2,
    updatedAt: "2026-11-09T09:00:00",
  },
];
export const analytics: AnalyticsData[] = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
].map((label, i) => ({
  label,
  generated: [8, 14, 11, 23, 18, 29, 25][i],
  engagement: [18, 29, 24, 42, 34, 56, 48][i],
}));
export function initialState(): DemoState {
  return {
    user: null,
    authenticated: false,
    rememberSession: true,
    workspace: {
      id: "workspace-demo",
      name: company.name,
      company: structuredClone(company),
    },
    onboarding: { step: 0, completed: false },
    preferences: structuredClone(preferences),
    competitorIds: ["urban", "daily", "bean"],
    customCompetitors: [],
    posts: structuredClone(posts),
    notifications: true,
  };
}
