import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { api, type UserMe, ApiError } from "../services/api";
import { clearWidgetCaches } from "../widgets/widgetCache";

export function useAuth() {
    const [user, setUser] = useState<UserMe | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const currentUserId = useRef<number | null>(null);
    const updateUser = useCallback((next: UserMe | null) => {
        const nextId = next?.id ?? null;
        if (currentUserId.current !== nextId) clearWidgetCaches();
        currentUserId.current = nextId;
        setUser(next);
    }, []);

    const checkAuth = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.get<UserMe>("/auth/me");
            updateUser(data);
        } catch (err) {
            updateUser(null);
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
                // Unauthenticated - expected when user has no cookie
                setError(null);
            } else if (err instanceof Error) {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    }, [updateUser]);

    useEffect(() => {
        void checkAuth();
    }, [checkAuth]);

    const login = async (email: string, password: string): Promise<boolean> => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.post<UserMe>("/auth/login", { email, password });
            updateUser(data);
            return true;
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            } else if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("Login failed");
            }
            return false;
        } finally {
            setLoading(false);
        }
    };

    const register = async (email: string, password: string): Promise<boolean> => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.post<UserMe>("/auth/register", { email, password });
            updateUser(data);
            return true;
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            } else if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("Registration failed");
            }
            return false;
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        setLoading(true);
        try {
            await api.post("/auth/logout");
        } catch {
            // Ignore logout errors
        } finally {
            updateUser(null);
            setLoading(false);
        }
    };

    return {
        user,
        loading,
        error,
        login,
        register,
        logout,
        checkAuth,
    };
}
