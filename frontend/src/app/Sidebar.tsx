'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './layout.module.css';

const navItems = [
    { href: '/', label: 'Monitoring', icon: '◉' },
    { href: '/eligibility', label: 'AI Chat', icon: '💬' },
    { href: '/history', label: 'Previous Check', icon: '☰' },
    { href: '/verify', label: 'Eligibility Check', icon: '＋' },
];

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className={styles.sidebar}>
            <div className={styles.sidebarLogo}>
                <div className={styles.logoIcon}>B</div>
                <div>
                    <div className={styles.logoText}>Bravebird</div>
                    <div className={styles.logoSub}>Platform</div>
                </div>
            </div>

            <nav className={styles.sidebarNav}>
                {navItems.map((item) => {
                    const isActive = pathname === item.href ||
                        (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                        >
                            <span className={styles.navIcon}>{item.icon}</span>
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className={styles.sidebarFooter}>
                <div className={styles.envBadge}>
                    <span className={styles.envDot}></span>
                    <span>Development</span>
                </div>
            </div>
        </aside>
    );
}
