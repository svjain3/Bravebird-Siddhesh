'use client';

import { usePathname } from 'next/navigation';
import Sidebar from "./Sidebar";
import styles from "./layout.module.css";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, loading, logout } = useAuth();
    const router = useRouter();

    const isLoginPage = pathname === '/login';

    useEffect(() => {
        if (!loading && !user && !isLoginPage) {
            router.push('/login');
        }
    }, [user, loading, isLoginPage, router]);

    if (loading) return null; // Or a spinner

    if (isLoginPage) {
        return <>{children}</>;
    }

    return (
        <div className={styles.layoutWrapper}>
            <Sidebar />
            <main className={styles.main}>
                <div className={styles.topBar}>
                    <div className={styles.userInfo}>
                        <span className={styles.userAvatar}>👤</span>
                        <span className={styles.userName}>{user?.name}</span>
                        <span className={styles.userSep}>•</span>
                        <span className={styles.userHospital}>🏥 {user?.hospital}</span>
                    </div>
                    <button className={styles.logoutBtn} onClick={logout}>
                        Sign Out
                    </button>
                </div>
                {children}
            </main>
        </div>
    );
}
