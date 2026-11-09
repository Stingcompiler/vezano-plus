"use client";

import { Button, Notice } from "@sting/ui-web";
import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl, getAccessToken } from "@/lib/api";

import { dayMonth, hhmm } from "./format";

/**
 * شريط إعلانات المنصة في لوحة المتجر (0005 §٢٣١): ما أرسلته المنصة إلى هذا المتجر ولم تنتهِ
 * نافذته. «إخفاء» يخفيه في هذا المتصفح وحده، والإعلان يبقى في صندوق الوارد.
 */
interface Ann {
  id: string;
  kind: string;
  kind_label: string;
  title: string;
  body: string;
  starts_at: string;
  ends_at: string;
  active: boolean;
  cta_label: string;
  cta_url: string;
}

const HIDDEN_KEY = "vz-ann-hidden";

function readHidden(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

const When = ({ iso }: { iso: string }) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

export function PlatformAnnouncements() {
  const [rows, setRows] = useState<Ann[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    setHidden(readHidden());
    const token = getAccessToken();
    if (!token) return;
    let gone = false;
    void fetch(`${apiBaseUrl()}/api/org/announcements`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ announcements: Ann[] }>) : null))
      .then((b) => {
        if (!gone && b) setRows(b.announcements);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, []);

  const shown = rows.filter((a) => !hidden.includes(a.id));
  if (!shown.length) return null;
  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      /* التخزين المحلي غير متاح: يُخفى حتى إعادة التحميل */
    }
  };
  return (
    <section className="home-ann" aria-label="إعلانات المنصة">
      {shown.map((a) => (
        <Notice
          key={a.id}
          kind={a.kind === "alert" || a.kind === "payment" ? "warning" : "info"}
          title={`${a.kind_label} — ${a.title}`}
          action={
            <div className="home-ann__actions">
              {a.cta_url ? (
                a.cta_url.startsWith("/") ? (
                  <Link href={a.cta_url} className="c-btn c-btn--secondary">
                    {a.cta_label}
                  </Link>
                ) : (
                  <a
                    href={a.cta_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="c-btn c-btn--secondary"
                  >
                    {a.cta_label}
                  </a>
                )
              ) : null}
              <Button variant="quiet" onClick={() => hide(a.id)}>
                إخفاء
              </Button>
            </div>
          }
        >
          <p className="acc-lead">{a.body}</p>
          <p className="acc-choice__note">
            {a.active ? "سارٍ حتى " : "من "}
            {a.active ? null : (
              <>
                <When iso={a.starts_at} /> إلى{" "}
              </>
            )}
            <When iso={a.ends_at} />
          </p>
        </Notice>
      ))}
    </section>
  );
}
