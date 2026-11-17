import type { Metadata } from "next";
import { Provider } from "@/store/provider";
import "./globals.css";
import "./crm.css";
import "./competitors.css";
export const metadata: Metadata = {
  title: "SocialAI — A little intelligence. A lot of impact.",
  description:
    "Social media content operations, brand management and editorial planning powered by AI.",
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
