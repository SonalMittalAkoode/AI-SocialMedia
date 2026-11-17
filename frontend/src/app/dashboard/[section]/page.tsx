import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { Studio } from "@/components/content/studio";
import { Posts } from "@/components/dashboard/posts";
import { Competitors } from "@/components/competitors";
import { Calendar } from "@/components/dashboard/calendar";
import { BrandForm } from "@/components/brand-form";
import { Accounts, Analytics, Settings } from "@/components/dashboard/sections";
import { Companies } from "@/components/dashboard/companies";
const sections = [
  "content-studio",
  "posts",
  "competitors",
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
          <Studio />
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
