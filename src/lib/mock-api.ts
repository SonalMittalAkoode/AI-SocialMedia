import { company, posts, competitors, analytics } from "@/data/fixtures";
import { CompanyProfile, GeneratedPost, SocialPlatform, User } from "@/types";
export const delay = (ms = 700) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function mockRegisterUser(user: User) {
  await delay();
  return user;
}
export const mockLogin = mockRegisterUser;
export async function mockAnalyzeBrand(
  website: string,
  existing: CompanyProfile,
) {
  await delay(2800);
  return website.includes("brewandbean.example")
    ? { ...structuredClone(company), website }
    : {
        ...existing,
        website,
        name:
          existing.name === company.name
            ? new URL(website).hostname.replace("www.", "").split(".")[0]
            : existing.name,
      };
}
export async function mockDiscoverCompetitors() {
  await delay(1800);
  return competitors;
}
export async function mockGeneratePosts(input: {
  brand: CompanyProfile;
  platform: SocialPlatform;
  topic: string;
  tone: string;
  format: string;
  language?: string;
  instructions?: string;
  fail?: boolean;
}): Promise<GeneratedPost[]> {
  await delay(2200);
  if (input.fail)
    throw new Error(
      "The demo generation was interrupted. Your settings are saved. Please try again.",
    );
  return posts.map((post, i) => {
    const cafe = /coffee|cafe|food|beverage/i.test(
      input.brand.industry + " " + input.brand.services,
    );
    const title =
      input.topic ||
      (cafe
        ? post.title
        : [
            "Meet your next favorite.",
            "Made for your everyday.",
            "A closer look at what we do.",
          ][i]);
    const intro =
      input.language === "Hindi"
        ? `${input.brand.name} के साथ हर दिन कुछ खास।`
        : input.language === "Hinglish"
          ? `${input.brand.name} ke saath, har din kuch khaas.`
          : cafe
            ? post.caption.replaceAll("Brew & Bean", input.brand.name)
            : `Discover ${input.brand.services || input.brand.industry} with ${input.brand.name}. ${input.brand.description} What would you like to explore next?`;
    return {
      ...post,
      id: crypto.randomUUID(),
      title,
      platform: input.platform,
      category: input.format,
      status: "Draft",
      scheduledAt: undefined,
      updatedAt: new Date().toISOString(),
      caption: `${intro}${input.topic ? ` Today’s spotlight: ${input.topic}.` : ""}${input.tone === "Professional" ? " Learn more about our approach." : input.tone === "Bold" ? " Make your next move count." : ""}${input.instructions ? " We would love to hear your perspective." : ""}`,
      hashtags: `#${input.brand.name.replace(/[^a-zA-Z0-9]/g, "")} #${cafe ? "CoffeeCulture" : "BrandStory"} #Community`,
    };
  });
}
export async function mockSavePost(post: GeneratedPost) {
  await delay(150);
  return { ...post, updatedAt: new Date().toISOString() };
}
export async function mockSchedulePost(post: GeneratedPost, date: string) {
  await delay(150);
  return { ...post, status: "Scheduled" as const, scheduledAt: date };
}
export async function mockGetAnalytics() {
  await delay();
  return analytics;
}
