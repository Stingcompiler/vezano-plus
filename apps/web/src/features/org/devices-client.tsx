"use client";

import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { Ago } from "@/features/org/ago";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "offline" | "stale";

export interface DeviceRow {
  id: string;
  name: string;
  prefix: string;
  branch_id: string;
  branch_name: string;
  status: string;
  connectivity: "connected" | "offline" | "stale" | "silent" | "revoked";
  last_seen_at: string;
  pending: number;
  pending_at: string;
  users: string[];
  registered_at: string;
  sells: boolean;
  /** الجهاز الذي تعمل عليه هذه الجلسة */
  is_current?: boolean;
}
interface Payload {
  devices: DeviceRow[];
  counts: { total: number; active: number; pending_total: number };
  device_limit: number | null;
  /** السحب للمالك وحده (0005 §٢٥٣) */
  can_revoke?: boolean;
  as_of: string;
}

export const DEVICES_CACHE_META = "org.devices_cache";
const STALE_MS = 10 * 60_000;

const CONN_LABEL: Record<DeviceRow["connectivity"], string> = {
  connected: "متصل",
  offline: "غير متصل",
  stale: "متقادم",
  silent: "صامت",
  revoked: "مسحوب",
};

/** «غير مرفوع»: عدد ما لم يُرفع بعد ومعناه — لا وصف «متصل» كاذب. */
function unsynced(d: DeviceRow): string {
  if (!d.sells) return "عرض ومتابعة فقط — لا بيع من هذا الجهاز";
  if (d.pending === 0 && d.connectivity === "connected") return "يرفع فوراً";
  if (d.connectivity === "stale" && d.pending > 0)
    return `السحب قبل الرفع يفقد ${d.pending} عملية.`;
  if (d.connectivity === "offline") return "يبيع محلياً الآن على الأرجح — غير متصل لا يعني متوقفاً";
  if (d.pending > 0) return `${d.pending} عمليات محفوظة محلياً لم تُرفع.`;
  return "لا معلّق";
}

/**
 * ORG-04 — الأجهزة: «آخر اتصال» رقم لا حالة وهمية (27-D20 ready/offline/stale · 39-D31 loading/
 * empty): الجهاز غير المتصل ليس معطّلاً؛ نعرض آخر اتصال ناجح وعدد ما لم يُرفع بعد. سحب الجهاز
 * فعل منفصل عن تعطيل مستخدم (ORG-05) ولا يُسحب جهاز له معلّق قبل عرض عدده (§٩.٣، §٨.١٣).
 *
 * السحب نفسه (0005 §٢٥٣): زرّ في صفّ كل جهاز فعّال للمالك وحده، ثم تأكيدٌ يعرض ما عليه من معلّق. الخادم
 * يرفض إن زاد المعلّق عمّا رآه المالك، فيُعرض العدد الجديد قبل أن يؤكّد.
 */
export function DevicesClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [data, setData] = useState<Payload | null>(null);
  const [cached, setCached] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState<DeviceRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeErr, setRevokeErr] = useState("");
  const [revoked, setRevoked] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    const raw = await storage.read((tx) => tx.getMeta(DEVICES_CACHE_META));
    if (raw) {
      try {
        setCached(JSON.parse(raw) as Payload);
      } catch {
        /* كاش تالف — يُتجاهل */
      }
    }
    if (!navigator.onLine) {
      setLoaded(true);
      return;
    }
    try {
      const { data: d, response } = await api().GET("/api/org/devices", {});
      if (response.ok && d) {
        const p = d as unknown as Payload;
        setData(p);
        setFailed(false);
        const json = JSON.stringify(p);
        await storage.transaction((tx) => tx.putMeta(DEVICES_CACHE_META, json));
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fdevices");
      return;
    }
    void load();
  }, [router, load, online]);

  const revoke = async (d: DeviceRow) => {
    setRevoking(true);
    setRevokeErr("");
    try {
      const {
        data: body,
        error,
        response,
      } = await api().POST("/api/org/devices/{device_id}/revoke", {
        params: { path: { device_id: d.id } },
        body: { pending_seen: d.pending },
      });
      if (response.ok && body) {
        const p = body as unknown as Payload;
        setData(p);
        const json = JSON.stringify(p);
        await getStorage().transaction((tx) => tx.putMeta(DEVICES_CACHE_META, json));
        setAsking(null);
        setRevoked(d.name);
        return;
      }
      const e = error as unknown as { detail?: string; extra?: { pending?: number } } | undefined;
      if (e?.detail === "pending_unseen" && typeof e.extra?.pending === "number") {
        // المعلّق زاد عمّا عُرض: يُعرض العدد الجديد ويبقى القرار للمالك
        setAsking({ ...d, pending: e.extra.pending });
        setRevokeErr("زاد ما لم يُرفع على هذا الجهاز — راجع العدد ثم أكّد.");
      } else if (e?.detail === "device_not_active") {
        setAsking(null);
        void load();
      } else setRevokeErr("تعذّر سحب الجهاز.");
    } catch {
      setRevokeErr("تعذّر سحب الجهاز.");
    } finally {
      setRevoking(false);
    }
  };

  const shown = data ?? cached;
  const canRevoke = Boolean(data?.can_revoke) && online;
  const asOfOld = shown ? Date.now() - new Date(shown.as_of).getTime() > STALE_MS : false;
  const state: State = !loaded
    ? "loading"
    : !online
      ? "offline"
      : !data && (failed || asOfOld) && cached
        ? "stale"
        : shown && shown.devices.length === 0
          ? "empty"
          : "ready";

  const columns = [
    {
      key: "device",
      header: "الجهاز",
      render: (d: DeviceRow) => (
        <div>
          <strong>{d.name}</strong>
          <p className="acc-choice__note">
            بادئة <span className="sting-mono">{d.prefix}</span>
            {d.is_current ? " · هذا الجهاز" : null}
          </p>
        </div>
      ),
    },
    {
      key: "branch",
      header: "الفرع والمستخدمون",
      render: (d: DeviceRow) => (
        <div>
          <span>{d.branch_name}</span>
          <p className="acc-choice__note">{d.users.join(" · ") || "—"}</p>
        </div>
      ),
    },
    {
      key: "seen",
      header: "آخر اتصال ناجح",
      render: (d: DeviceRow) => <Ago iso={d.last_seen_at} />,
    },
    {
      key: "pending",
      header: "غير مرفوع",
      render: (d: DeviceRow) => {
        const t = unsynced(d);
        const parts = t.split(/([0-9]+)/);
        return (
          <span>
            {parts.map((p, i) =>
              /^[0-9]+$/.test(p) ? (
                <span key={i} className="sting-mono">
                  {p}
                </span>
              ) : (
                p
              ),
            )}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "الحالة",
      render: (d: DeviceRow) => (
        <span
          className={`org-badge org-badge--${d.connectivity === "connected" ? "active" : d.connectivity === "stale" ? "expired" : "disabled"}`}
        >
          {CONN_LABEL[d.connectivity]}
        </span>
      ),
    },
    ...(canRevoke
      ? [
          {
            key: "revoke",
            header: "السحب",
            render: (d: DeviceRow) =>
              d.status === "active" ? (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setRevokeErr("");
                    setRevoked("");
                    setAsking(d);
                  }}
                >
                  اسحب الجهاز
                </Button>
              ) : (
                <span className="acc-choice__note">—</span>
              ),
          },
        ]
      : []),
  ];

  return (
    <Frame title="الأجهزة" nav={<AppNav currentId="org-devices" />} footer={null}>
      <div className="sys sys--wide" data-screen="ORG-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قائمة الأجهزة وتفاصيلها</h2>
            <span className="cat-head__hint">الجهاز عهدةٌ عليها عمل.</span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الأجهزة">
                <p className="acc-lead">مع حالة المزامنة لكل جهاز.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا أجهزة مسجّلة">
                <p className="acc-lead">منشأة أُنشئت ولم يُهيّأ عليها جهاز بعد.</p>
                {/* فحص 2026-10-17 F03: الإجراء نفسه لا وصفه فقط */}
                <div className="acc-actions">
                  <Button onClick={() => router.push("/setup-device")}>جهّز هذا الجهاز</Button>
                </div>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Status
                state="offline"
                label={
                  cached
                    ? "بلا اتصال — القائمة كما كانت عند آخر تحديث"
                    : "بلا اتصال — لا قائمة مخزَّنة بعد"
                }
              />
            ) : null}
            {state === "stale" ? (
              <Status state="stale" label="القائمة قديمة — تعذّر التحديث من الخادم" />
            ) : null}

            {shown && shown.devices.length > 0 ? (
              <>
                <div className="cat-head">
                  <h3 className="cat-head__title">
                    الأجهزة — <span className="sting-mono">{shown.counts.active}</span>
                    {shown.device_limit !== null ? (
                      <>
                        {" "}
                        من حدّ الباقة <span className="sting-mono">{shown.device_limit}</span>
                      </>
                    ) : null}
                  </h3>
                  <span className="cat-head__hint">
                    الوقت المعروض بتوقيت المنشأة · آخر تحديث <Ago iso={shown.as_of} />
                  </span>
                </div>
                {revoked ? <Status state="success" label={`سُحب الجهاز «${revoked}».`} /> : null}
                {asking ? (
                  <Notice kind="warning" title={`سحب الجهاز «${asking.name}»`}>
                    <p className="acc-lead">
                      يتوقف دخوله ورفعه فوراً، ويتحرّر مكانه من حدّ الباقة.
                      {asking.is_current
                        ? " هذا هو الجهاز الذي تعمل عليه الآن — سحبه يوقف البيع والمزامنة منه."
                        : null}
                    </p>
                    {asking.pending > 0 ? (
                      <p className="acc-lead">
                        عليه <span className="sting-mono">{asking.pending}</span> عمليات محفوظة
                        محلياً لم تُرفع.
                      </p>
                    ) : null}
                    {revokeErr ? <Status state="validation_error" label={revokeErr} /> : null}
                    <div className="acc-links">
                      <Button loading={revoking} onClick={() => void revoke(asking)}>
                        اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً
                      </Button>
                      <Button variant="quiet" onClick={() => setAsking(null)}>
                        إلغاء
                      </Button>
                    </div>
                  </Notice>
                ) : null}
                <Table
                  caption="الأجهزة"
                  columns={columns}
                  rows={shown.devices}
                  rowKey={(d) => d.id}
                />
                <p className="acc-choice__note">
                  <strong>سحب الجهاز فعل منفصل عن تعطيل مستخدم.</strong> ولا نسحب جهازاً له عمليات
                  لم تُرفع قبل أن نعرض عددها ونحذّر: السحب قبل الرفع يعني فقد تلك العمليات، والقرار
                  للمالك بعد أن يراه مكتوباً.
                </p>
                <p className="acc-choice__note">
                  الجهاز غير المتصل ليس معطّلاً؛ لعله يبيع محلياً الآن.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
