import type { Metadata } from "next";
import "./globals.css";
import styles from "./layout.module.css";
import Sidebar from "./Sidebar";

export const metadata: Metadata = {
  title: "Bravebird Platform",
  description: "Eligibility verification and automation dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className={styles.layoutWrapper}>
          <Sidebar />
          <main className={styles.main}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
