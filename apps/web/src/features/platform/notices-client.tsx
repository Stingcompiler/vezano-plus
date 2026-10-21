"use client";

import { Button, Notice, Status } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

interface NoticeRow {
  id: string;
  kind: string;
  kind_label: string;
  title: string;
  body: string;
  href: string;
  tenant_name: string;
  created_at: string;
  read: boolean;
  read_by_name: string;
}
interface Payload {
  unread: number;
  new_messages: number;
  notices: NoticeRow[];
}

/**
 * PLT-15 — إشعارات فريق المنصة (0005 §١٩٠): ما وصل من التجار وينتظر نظراً — منشأة بانتظار الاعتماد،
 * إيصال دفع، رسالة دعم، طلب جولة، طلب تحقّق، بلاغ سوق. صندوق مشترك: أول من يقرأ يعلّمه باسمه.
 */
export function NoticesClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    try {
      const { data: d, response } = await platformApi().GET("/api/platform/notices", {
        params: { query: { limit: 100, ...(unreadOnly ? { unread: "1" } : {}) } },
      });
      if (response.ok && d) {
        setData(d);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [router, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (ids: string[] | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await platformApi().POST("/api/platform/notices/read", {
        body: (ids ? { ids } : {}) as never,
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const state = failed
    ? "server_error"
    : data === null
      ? "loading"
      : data.notices.length
        ? "ready"
        : "empty";

  return (
    <PlatformFrame current="notices">
      <div className="sys sys--wide plt-frame" data-screen="PLT-15" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الإشعارات</h2>
            <span className="cat-head__hint">
              ما وصل من التجار وينتظر نظر الفريق — صندوق مشترك: أول من يقرأ يعلّمه باسمه.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="التصفية">
                <button
                  type="button"
                  className={`pos-chip${!unreadOnly ? " pos-chip--on" : ""}`}
                  aria-pressed={!unreadOnly}
                  onClick={() => setUnreadOnly(false)}
                >
                  الكل
                </button>
                <button
                  type="button"
                  className={`pos-chip${unreadOnly ? " pos-chip--on" : ""}`}
                  aria-pressed={unreadOnly}
                  onClick={() => setUnreadOnly(true)}
                >
                  غير المقروء
                  {data ? (
                    <>
                      {" "}
                      · <span className="sting-mono">{data.unread}</span>
                    </>
                  ) : null}
                </button>
              </div>
              <Button
                variant="secondary"
                onClick={() => void markRead(null)}
                loading={busy}
                disabledReason={data && data.unread > 0 ? undefined : "لا إشعار غير مقروء"}
              >
                علّم الكل مقروءاً
              </Button>
            </div>

            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر تحميل الإشعارات">
                <p className="acc-lead">أعد المحاولة بعد قليل.</p>
                <div className="acc-links">
                  <Button onClick={() => void load()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title={unreadOnly ? "لا إشعار غير مقروء" : "لا إشعارات بعد"}>
                <p className="acc-lead">
                  تصل هنا المنشآت الجديدة وإيصالات الدفع ورسائل الدعم وطلبات الجولة والتحقّق
                  والبلاغات فور وصولها.
                </p>
              </Notice>
            ) : null}

            <ul className="plt-notices" aria-label="الإشعارات">
              {data?.notices.map((n) => (
                <li key={n.id} className={`plt-notice${n.read ? "" : " plt-notice--new"}`}>
                  <div className="plt-notice__main">
                    <div className="plt-notice__title">
                      {n.read ? null : <Status state="stale" label="جديد" />} {n.title}
                    </div>
                    <div className="acc-choice__note">
                      {n.kind_label}
                      {n.tenant_name ? ` · ${n.tenant_name}` : ""} · {dayMonth(n.created_at).day}{" "}
                      {dayMonth(n.created_at).month}{" "}
                      <span className="sting-mono">{hhmm(n.created_at)}</span>
                      {n.read && n.read_by_name ? ` · قرأه ${n.read_by_name}` : ""}
                    </div>
                    {n.body ? <div className="acc-lead">{n.body}</div> : null}
                  </div>
                  <div className="plt-notice__actions">
                    {n.href ? (
                      <Link
                        href={n.href}
                        className="c-btn c-btn--secondary"
                        onClick={() => void markRead([n.id])}
                      >
                        افتح
                      </Link>
                    ) : null}
                    {n.read ? null : (
                      <Button variant="quiet" onClick={() => void markRead([n.id])}>
                        علّمه مقروءاً
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
