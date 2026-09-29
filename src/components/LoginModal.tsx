'use client';

import React, { useState, useEffect } from "react";
import styles from "./LoginModal.module.scss";
import { MapPin, Mail, Lock, Server, AlertCircle, Loader2 } from "lucide-react";

export type LoginModalProps = {
  isOpen: boolean;
  onLoginSuccess: (
    user: { id: string; name: string; email: string },
    token?: string
  ) => void;
};

export default function LoginModal({ isOpen, onLoginSuccess }: LoginModalProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("geopic_immich_url");
      if (saved) {
        setServerUrl(saved);
        return;
      }
    }

    fetch("/api/auth/login")
      .then((res) => res.json())
      .then((data) => {
        if (data.defaultServerUrl) {
          setServerUrl((prev) => (prev ? prev : data.defaultServerUrl));
        }
      })
      .catch(() => {});
  }, []);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const cleanServerUrl = serverUrl.trim();
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          serverUrl: cleanServerUrl || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Login failed. Check your credentials.");
      }

      if (cleanServerUrl && typeof window !== "undefined") {
        localStorage.setItem("geopic_immich_url", cleanServerUrl);
      }

      onLoginSuccess(data.user, data.token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      console.error("[LoginModal] Login error:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.logoIcon}>
          <MapPin size={28} />
        </div>
        <h2 className={styles.title}>Immich GeoPic</h2>
        <p className={styles.subtitle}>Sign in with your Immich account to get started</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Immich Server URL</label>
            <div className={styles.inputWrapper}>
              <Server size={16} className={styles.inputIcon} />
              <input
                type="text"
                className={styles.input}
                placeholder="http://192.168.10.124:2283"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={loading}
              />
            </div>
            <span className={styles.helperText}>
              IP address or domain of your Immich instance (e.g. http://192.168.10.124:2283)
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Immich Email</label>
            <div className={styles.inputWrapper}>
              <Mail size={16} className={styles.inputIcon} />
              <input
                type="email"
                required
                className={styles.input}
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Immich Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                type="password"
                required
                className={styles.input}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Signing In...</span>
              </>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>

        <p className={styles.securityNote}>
          Your credentials are authenticated directly through GeoPic server proxy. Immich tokens are kept secure server-side.
        </p>
      </div>
    </div>
  );
}
