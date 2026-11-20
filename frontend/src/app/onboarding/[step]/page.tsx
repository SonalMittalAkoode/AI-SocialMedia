import { Onboarding } from "@/components/onboarding";
import { steps } from "@/lib/storage";
import { notFound, redirect } from "next/navigation";
export function generateStaticParams() {
  return steps.map((step) => ({ step }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  if (["competitors", "preferences", "generate"].includes(step)) redirect("/onboarding/goals");
  if (!steps.includes(step)) notFound();
  return <Onboarding step={step} />;
}
