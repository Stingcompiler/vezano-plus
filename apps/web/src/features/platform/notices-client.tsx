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
import { pushPermission, pushSupported, subscribePush } from "@/lib/pwa";
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
interface PushState {
  configured: boolean;
  public_key: string;
  subscribed: boolean;
}

/**
 * 0005 §٢١٦ — تنبيهات هذا المتصفح: ما يصل صندوق الفريق يُدفع فوراً للمتصفح المشترك، ولو كانت
 * الصفحة مغلقة. لكل مشغّل متصفحه؛ الإذن يطلبه المتصفح نفسه.
 */
function BrowserAlerts() {
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const { data, response } = await platformApi().GET("/api/platform/push", {});
    if (response.ok && data) setSt(data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!st) return null;
  const supported = pushSupported();
  const denied = pushPermission() === "denied";
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    try {
      if (st.subscribed) {
        // مراجعة 2026-11-08: اشتراك المتصفح واحد للأصل كله ويشاركه اشتراك جهاز المتجر (WEB-02) —
        // الإيقاف هنا يُلغي ربط المشغّل في الخادم فقط ولا يمسّ اشتراك المتصفح
        const { data } = await platformApi().POST("/api/platform/push/unsubscribe", {
          body: {} as never,
        });
        setSt(data as unknown as PushState);
        return;
      }
      const keys = await subscribePush(st.public_key);
      if (!keys) {
        setNote("لم يُمنح الإذن. اسمح بالإشعارات لهذا الموقع من إعدادات المتصفح.");
        return;
      }
      const { data, response } = await platformApi().POST("/api/platform/push/subscribe", {
        body: keys as never,
      });
      if (response.ok) setSt(data as unknown as PushState);
      else setNote("تعذّر التفعيل. أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="plt-push">
      <div className="plt-push__text">
        <strong>تنبيهات هذا المتصفح</strong>
        <span className="acc-choice__note">
          {!st.configured
            ? "مفاتيح الإشعارات غير مضبوطة على الخادم بعد."
            : st.subscribed
              ? "مفعّلة: يصل كل جديد هنا فوراً ولو كانت الصفحة مغلقة."
              : "يصل كل جديد فوراً بدل انتظار تحديث القائمة."}
          {note ? ` ${note}` : ""}
        </span>
      </div>
      <Button
        variant={st.subscribed ? "quiet" : "secondary"}
        onClick={() => void toggle()}
        loading={busy}
        disabledReason={
          !st.configured
            ? "غير مضبوطة على الخادم"
            : !supported
              ? "المتصفح لا يدعم الإشعارات"
              : denied && !st.subscribed
                ? "الإذن مرفوض في إعدادات المتصفح"
                : undefined
        }
      >
        {st.subscribed ? "أوقف التنبيهات هنا" : "فعّل التنبيهات هنا"}
      </Button>
    </div>
  );
}

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
            <BrowserAlerts />
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
