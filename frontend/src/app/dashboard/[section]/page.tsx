import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { Studio } from "@/components/content/studio";
import { Posts } from "@/components/dashboard/posts";
import { Competitors } from "@/components/competitors";
import { TrendResearch } from "@/components/dashboard/trend-research";
import { Calendar } from "@/components/dashboard/calendar";
import { BrandForm } from "@/components/brand-form";
import { ContentPreferenceSettings } from "@/components/preferences";
import { Accounts, Analytics, Settings } from "@/components/dashboard/sections";
import { Companies } from "@/components/dashboard/companies";
import { AccountAvailability } from "@/components/social-availability";
const sections = [
  "content-studio",
  "posts",
  "competitors",
  "trends",
  "calendar",
  "brand",
  "accounts",
  "analytics",
  "settings",
  "companies",
];
export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{
    q?: string;
    edit?: string;
    status?: string;
    view?: string;
    generation?: string;
    media?: string;
    schedule?: string;
    social?: string;
    company?: string;
    first?: string;
    new?: string;
    topic?: string;
  }>;
}) {
  const { section } = await params;
  const search = await searchParams;
  switch (section) {
    case "content-studio":
      return (
        <>
          <PageHeading
            eyebrow="CONTENT CREATION"
            title="AI Content Studio"
            description="Generate content using your confirmed brand. Review results and save the drafts you want to keep."
          />
          <AccountAvailability />
          <Studio first={search.first === "1"} newBrief={search.new === "1"}
            initialTopic={typeof search.topic === "string" ? search.topic.trim().slice(0, 500) : ""}
            briefCompany={search.company} />
        </>
      );
    case "posts":
      return (
        <Posts
          key={`${search.q}-${search.edit}-${search.status}-${search.view}-${search.generation}-${search.media}`}
          initialQuery={search.q}
          initialEdit={search.edit}
          initialStatus={search.status}
          initialView={search.view}
          initialGeneration={search.generation}
          initialMedia={search.media}
        />
      );
    case "competitors":
      // The workspace renders its own page header and company context.
      return <Competitors />;
    case "trends":
      return <TrendResearch />;
    case "calendar":
      return (
        <Calendar
          initialSchedule={search.schedule}
          initialStatus={search.status}
        />
      );
    case "companies":
      return <Companies />;
    case "brand":
      return (
        <>
          <PageHeading
            eyebrow="COMPANY IDENTITY"
            title="Brand Profile"
            description="Manage business information, brand research and confirmation."
          />
          <div className="panel brand-profile-panel">
            <BrandForm />
          </div>
          <ContentPreferenceSettings />
        </>
      );
    case "accounts":
      return (
        <Accounts
          key={`${search.social}-${search.company}`}
          outcome={search.social}
          outcomeCompany={search.company}
        />
      );
    case "analytics":
      return <Analytics />;
    case "settings":
      return <Settings />;
    default:
      notFound();
  }
}
