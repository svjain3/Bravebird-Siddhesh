'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface User {
    id: string;
    name: string;
    role: 'admin' | 'user';
    hospital: string;
}

interface AuthContextType {
    user: User | null;
    login: (username: string, password?: string) => boolean;
    logout: () => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface HospitalAccount {
    id: string;
    name: string;
    role: 'admin' | 'user';
    password: string;
    hospital: string;
}

const HOSPITAL_USERS: Record<string, HospitalAccount> = {
    'mercy_admin': {
        id: 'mercy_001',
        name: 'Mercy Admin',
        role: 'admin',
        password: 'Mercy@123',
        hospital: 'Mercy General',
    },
    'stjude_admin': {
        id: 'stjude_001',
        name: 'St. Jude Admin',
        role: 'admin',
        password: 'StJude@123',
        hospital: 'St. Jude Medical',
    },
    'cityhope_admin': {
        id: 'hope_001',
        name: 'City Hope Admin',
        role: 'admin',
        password: 'CityHope@123',
        hospital: 'City Hope Clinic',
    },
};

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const storedUser = localStorage.getItem('bravebird_user');
        if (storedUser) {
            const parsed = JSON.parse(storedUser);
            // Clear stale sessions missing hospital field
            if (!parsed.hospital) {
                localStorage.removeItem('bravebird_user');
            } else {
                setUser(parsed);
            }
        }
        setLoading(false);
    }, []);

    const login = (username: string, password?: string) => {
        const account = HOSPITAL_USERS[username];

        if (account && account.password === password) {
            const safeUser: User = {
                id: account.id,
                name: account.name,
                role: account.role,
                hospital: account.hospital,
            };

            setUser(safeUser);
            localStorage.setItem('bravebird_user', JSON.stringify(safeUser));
            router.push('/');
            return true;
        }
        return false;
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('bravebird_user');
        router.push('/login');
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
