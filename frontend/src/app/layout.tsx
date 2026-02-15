import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";
import styles from "./layout.module.css";
import Sidebar from "./Sidebar";
import ClientLayout from "./ClientLayout";

export const metadata: Metadata = {
  title: "Bravebird Platform",
  description: "Eligibility verification and automation dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ClientLayout>{children}</ClientLayout>
        </AuthProvider>
      </body>
    </html>
  );
}
