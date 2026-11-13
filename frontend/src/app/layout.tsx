import type { Metadata } from "next";
import { Provider } from "@/store/provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "SocialAI — A little intelligence. A lot of impact.",
  description:
    "Your brand, your voice, powered by AI. A frontend demo social media workspace.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
