import { Onboarding } from "@/components/onboarding";
import { steps } from "@/lib/storage";
import { notFound } from "next/navigation";
export function generateStaticParams() {
  return steps.map((step) => ({ step }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  if (!steps.includes(step)) notFound();
  return <Onboarding step={step} />;
}
