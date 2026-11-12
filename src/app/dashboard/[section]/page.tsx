import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { Studio } from "@/components/content/studio";
import { Posts } from "@/components/dashboard/posts";
import { Competitors } from "@/components/competitors";
import { Calendar } from "@/components/dashboard/calendar";
import { BrandForm } from "@/components/brand-form";
import { Accounts, Analytics, Settings } from "@/components/dashboard/sections";
const sections = [
  "content-studio",
  "posts",
  "competitors",
  "calendar",
  "brand",
  "accounts",
  "analytics",
  "settings",
];
export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ q?: string; edit?: string }>;
}) {
  const { section } = await params;
  const search = await searchParams;
  switch (section) {
    case "content-studio":
      return (
        <>
          <PageHeading
            eyebrow="A BLANK PAGE. ENDLESS POSSIBILITIES."
            title="Let’s make something worth sharing."
            description="Your brand’s voice, a little inspiration, and a whole new direction."
          />
          <Studio />
        </>
      );
    case "posts":
      return (
        <Posts
          key={`${search.q}-${search.edit}`}
          initialQuery={search.q}
          initialEdit={search.edit}
        />
      );
    case "competitors":
      return (
        <>
          <PageHeading
            eyebrow="INSPIRATION IS EVERYWHERE"
            title="A fresh perspective on your market."
            description="Explore example strategies and find the space only your brand can fill."
          />
          <Competitors />
        </>
      );
    case "calendar":
      return <Calendar />;
    case "brand":
      return (
        <>
          <PageHeading
            eyebrow="THE HEART OF YOUR WORKSPACE"
            title="Every detail. Entirely you."
            description="Shape the identity that guides your next great post."
          />
          <div className="panel brand-profile-panel">
            <BrandForm />
          </div>
        </>
      );
    case "accounts":
      return <Accounts />;
    case "analytics":
      return <Analytics />;
    case "settings":
      return <Settings />;
    default:
      notFound();
  }
}
