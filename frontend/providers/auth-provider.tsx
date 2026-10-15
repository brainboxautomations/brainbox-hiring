"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/configurations/supabase-browser-configuration";

type AuthContextValue = {
  user: User | null;

  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = Readonly<{
  children: ReactNode;

  initialSession: Session | null;
}>;

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const router = useRouter();
  const [supabase] = useState(createSupabaseBrowserClient);
  const [user, setUser] = useState<User | null>(initialSession?.user ?? null);
  const [loading, setLoading] = useState(initialSession === null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);

      router.refresh();
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
        router.replace("/admin");
      },
    }),
    [user, loading, supabase, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
