"use client";

import {
  Button,
  Frame,
  Notice,
  SelectField,
  TextField,
  Upload,
  type UploadItem,
} from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/platform/platform.css";
import "./store.css";
import { AppNav } from "@/features/home/app-nav";
import { operatorRole, operatorToken } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";
import { apiBaseUrl, getAccessToken } from "@/lib/api";

import { PlatformIcon, type Platform } from "./platform-icon";

/**
 * متجر التطبيقات (0005 §٢١٥): الإصدارات صفوف لا بطاقات، والنظام مرشّح واحد. ثلاثة مداخل:
 * - الصفحة العامة: الاسم والنظام والإصدار فقط، و«سجّل الدخول للتنزيل».
 * - التاجر (ORG-11): ينزّل الملف برابط موقَّع قصير العمر بمدير تنزيلات المتصفح، ويرى الحجم والبصمة.
 * - مدير المنصة (PLT-18): ينشر بملف (مع تقدّم الرفع) أو برابط آيفون، ويسحب الإصدار.
 */

const PLATFORMS: readonly { value: Platform; label: string }[] = [
  { value: "android", label: "أندرويد" },
  { value: "ios", label: "آيفون" },
  { value: "windows", label: "ويندوز" },
  { value: "macos", label: "ماك" },
];
const ACCEPT: Record<Exclude<Platform, "ios">, string> = {
  android: ".apk",
  windows: ".exe,.msi",
  macos: ".dmg,.pkg",
};
const MAX_BYTES = 512 * 1024 * 1024;

export interface Release {
  id: string;
  name: string;
  platform: Platform;
  platform_label: string;
  version: string;
  published_at: string;
  filename?: string;
  size_bytes?: number;
  sha256?: string;
  apple_url?: string;
}

/** رموز رفض الخادم بنصّ يقول ما الخطأ وكيف يُصلح. */
const ERRORS: Record<string, string> = {
  file_required: "اختر ملف التثبيت.",
  file_type_invalid: "الامتداد لا يناسب النظام المختار.",
  file_too_large: "الحد الأقصى للملف 512 ميبيبايت.",
  apple_url_invalid: "أدخل رابطاً من apps.apple.com أو testflight.apple.com.",
  release_exists: "هذا الإصدار منشور بالفعل لهذا التطبيق والنظام.",
  storage_full: "مساحة المتجر ممتلئة. اسحب إصدارات قديمة ثم أعد النشر.",
  admin_required: "النشر لمدير المنصة وحده.",
};

const mib = (n: number) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);

async function getJson(path: string, token: string | null): Promise<Response> {
  return fetch(apiBaseUrl() + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
}

function useCatalog(path: string, token: () => string | null, onUnauthorized?: () => void) {
  const [rows, setRows] = useState<Release[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await getJson(path, token());
      if (r.status === 401 && onUnauthorized) {
        onUnauthorized();
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as { releases: Release[] };
      setRows(body.releases);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [path, token, onUnauthorized]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, setRows, failed, load };
}

function PlatformChips({
  value,
  onChange,
  rows,
}: {
  value: Platform | "";
  onChange: (v: Platform | "") => void;
  rows: readonly Release[];
}) {
  const count = (p: Platform | "") => rows.filter((r) => !p || r.platform === p).length;
  return (
    <div className="pos-chips vz-apps__chips" role="group" aria-label="النظام">
      {[{ value: "" as const, label: "كل الأنظمة" }, ...PLATFORMS].map((p) => (
        <button
          key={p.value || "all"}
          type="button"
          className={`pos-chip${value === p.value ? " pos-chip--on" : ""}`}
          aria-pressed={value === p.value}
          onClick={() => onChange(p.value)}
        >
          {p.value ? <PlatformIcon platform={p.value} size={16} /> : null}
          {p.label} · <span className="sting-mono">{count(p.value)}</span>
        </button>
      ))}
    </div>
  );
}

function ReleaseRow({
  r,
  action,
  details,
}: {
  r: Release;
  action: React.ReactNode;
  details?: boolean;
}) {
  return (
    <li className="vz-app">
      <span className="vz-app__icon" data-platform={r.platform}>
        <PlatformIcon platform={r.platform} size={30} />
      </span>
      <div className="vz-app__main">
        <strong className="vz-app__name">{r.name}</strong>
        <span className="acc-choice__note">
          {r.platform_label} · الإصدار <span className="sting-mono">{r.version}</span>
          {details && r.size_bytes ? (
            <>
              {" "}
              · <span className="sting-mono">{mib(r.size_bytes)}</span> ميبيبايت
            </>
          ) : null}
        </span>
        {details && r.sha256 ? (
          <span className="vz-app__sha">
            بصمة SHA-256 <code className="sting-mono">{r.sha256}</code>
          </span>
        ) : null}
      </div>
      <div className="vz-app__action">{action}</div>
    </li>
  );
}

function List({
  rows,
  filter,
  render,
}: {
  rows: readonly Release[];
  filter: Platform | "";
  render: (r: Release) => React.ReactNode;
}) {
  const shown = rows.filter((r) => !filter || r.platform === filter);
  if (!shown.length)
    return (
      <Notice kind="empty" title="لا إصدارات منشورة لهذا النظام">
        <p className="acc-lead">تظهر هنا الإصدارات فور نشرها من إدارة المنصة.</p>
      </Notice>
    );
  return (
    <ul className="vz-apps" aria-label="الإصدارات">
      {shown.map(render)}
    </ul>
  );
}

/** قسم الصفحة الرئيسية: تصفّح بلا جلسة، والتنزيل بعد الدخول. */
export function PublicAppsSection() {
  const token = useCallback(() => null, []);
  const { rows, failed } = useCatalog("/api/public/apps", token);
  const [filter, setFilter] = useState<Platform | "">("");
  if (failed || (rows && rows.length === 0)) return null;
  return (
    <section id="lp-apps" className="lp__section" aria-labelledby="lp-apps-title">
      <div className="lp__wrap">
        <div className="lp__center">
          <h2 id="lp-apps-title">متجر التطبيقات</h2>
          <p className="lp__lead">
            نسخ فيزانو لأندرويد وآيفون وويندوز وماك. تصفّحها هنا، وتنزّلها من حسابك بعد الدخول.
          </p>
        </div>
        {rows ? (
          <div className="vz-apps__box">
            <PlatformChips value={filter} onChange={setFilter} rows={rows} />
            <List
              rows={rows}
              filter={filter}
              render={(r) => (
                <ReleaseRow
                  key={r.id}
                  r={r}
                  action={
                    <Link href="/login?next=%2Forg%2Fapps" className="c-btn c-btn--secondary">
                      سجّل الدخول للتنزيل
                    </Link>
                  }
                />
              )}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** ORG-11 — متجر التطبيقات للتاجر. */
export function MerchantAppsClient() {
  const router = useRouter();
  const goLogin = useCallback(() => router.replace("/login?next=/org/apps"), [router]);
  const { rows, failed, load } = useCatalog("/api/org/apps", getAccessToken, goLogin);
  const [filter, setFilter] = useState<Platform | "">("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const download = async (r: Release) => {
    setBusyId(r.id);
    setMessage("");
    try {
      const res = await fetch(`${apiBaseUrl()}/api/org/apps/${r.id}/link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      if (res.status === 401) return goLogin();
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      // مدير تنزيلات المتصفح يتولّى الملف: لا يُحمَّل في ذاكرة الصفحة
      window.location.assign(apiBaseUrl() + url);
      setMessage(`بدأ تنزيل ${r.filename ?? r.name}. قارن البصمة قبل التثبيت.`);
    } catch {
      setMessage("تعذّر بدء التنزيل. أعد المحاولة.");
    } finally {
      setBusyId(null);
    }
  };

  const state = failed
    ? "server_error"
    : rows === null
      ? "loading"
      : rows.length
        ? "ready"
        : "empty";
  return (
    <Frame title="متجر التطبيقات" nav={<AppNav currentId="apps" />} footer={null}>
      <div className="sys sys--wide" data-screen="ORG-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">متجر التطبيقات</h2>
            <span className="cat-head__hint">
              نسخ فيزانو لأجهزتك. ملف أندرويد وويندوز وماك يُنزَّل من هنا، وآيفون من App Store أو
              TestFlight.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر تحميل التطبيقات">
                <p className="acc-lead">أعد المحاولة بعد قليل.</p>
                <div className="acc-links">
                  <Button onClick={() => void load()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}
            {state === "loading" ? <p className="acc-lead">جارٍ تحميل التطبيقات…</p> : null}
            {rows ? (
              <>
                <PlatformChips value={filter} onChange={setFilter} rows={rows} />
                <List
                  rows={rows}
                  filter={filter}
                  render={(r) => (
                    <ReleaseRow
                      key={r.id}
                      r={r}
                      details
                      action={
                        r.apple_url ? (
                          <a
                            href={r.apple_url}
                            target="_blank"
                            rel="noreferrer"
                            className="c-btn c-btn--secondary"
                          >
                            {r.apple_url.includes("testflight.")
                              ? "فتح في TestFlight"
                              : "فتح في App Store"}
                          </a>
                        ) : (
                          <Button loading={busyId === r.id} onClick={() => void download(r)}>
                            تنزيل ملف التثبيت
                          </Button>
                        )
                      }
                    />
                  )}
                />
              </>
            ) : null}
            <p role="status" className="acc-choice__note">
              {message}
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** PLT-18 — متجر التطبيقات لمدير المنصة. */
export function OperatorAppsClient() {
  const router = useRouter();
  const goLogin = useCallback(() => router.replace("/platform/login"), [router]);
  const { rows, setRows, failed, load } = useCatalog("/api/platform/apps", operatorToken, goLogin);
  const [filter, setFilter] = useState<Platform | "">("");
  const [platform, setPlatform] = useState<Platform>("android");
  const [name, setName] = useState("Vezano Plus");
  const [version, setVersion] = useState("");
  const [appleUrl, setAppleUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = operatorRole() === "admin";

  useEffect(() => {
    if (!operatorToken()) goLogin();
  }, [goLogin]);

  const fileItem: UploadItem[] = file
    ? [
        {
          id: "f",
          name: file.name,
          sizeLabel: `${mib(file.size)} ميبيبايت`,
          progress,
          error: file.size > MAX_BYTES ? ERRORS.file_too_large : undefined,
        },
      ]
    : [];

  const publish = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");
    const body = new FormData();
    body.set("name", name.trim());
    body.set("version", version.trim());
    body.set("platform", platform);
    if (platform === "ios") body.set("apple_url", appleUrl.trim());
    else if (file) body.set("file", file);
    setBusy(true);
    // XHR لا fetch: تقدّم رفع ملف كبير على شبكة بطيئة
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl()}/api/platform/apps`);
    xhr.setRequestHeader("Authorization", `Bearer ${operatorToken() ?? ""}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onloadend = () => {
      setBusy(false);
      setProgress(undefined);
      let detail = "";
      try {
        detail = String((JSON.parse(xhr.responseText) as { detail?: string }).detail ?? "");
      } catch {
        detail = "";
      }
      if (xhr.status === 201) {
        setMessage("نُشر الإصدار وصار متاحاً للتجار.");
        setVersion("");
        setFile(null);
        setAppleUrl("");
        void load();
      } else if (xhr.status === 401) goLogin();
      else setError(ERRORS[detail] ?? "تعذّر النشر. تحقّق من الاتصال وأعد المحاولة.");
    };
    xhr.send(body);
  };

  const remove = async (r: Release) => {
    if (
      !window.confirm(
        `سحب ${r.name} ${r.platform_label} ${r.version}؟ يُحذف ملفه ولا يعود متاحاً للتجار.`,
      )
    )
      return;
    const res = await fetch(`${apiBaseUrl()}/api/platform/apps/${r.id}/remove`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken() ?? ""}` },
    });
    if (res.ok) {
      setRows(((await res.json()) as { releases: Release[] }).releases);
      setMessage("سُحب الإصدار.");
    } else setError("تعذّر سحب الإصدار.");
  };

  const ready = Boolean(
    name.trim() && version.trim() && (platform === "ios" ? appleUrl.trim() : file),
  );
  const state = failed
    ? "server_error"
    : rows === null
      ? "loading"
      : rows.length
        ? "ready"
        : "empty";
  return (
    <PlatformFrame current="apps">
      <div className="sys sys--wide plt-frame" data-screen="PLT-18" data-state={state}>
        {admin ? (
          <form className="cat-table pos-card vz-publish" onSubmit={publish}>
            <div className="cat-head">
              <h2 className="cat-head__title">نشر إصدار</h2>
              <span className="cat-head__hint">
                يظهر فور نشره في الصفحة الرئيسية ومتجر التاجر. لا يُنشر الإصدار نفسه مرتين.
              </span>
            </div>
            <div className="acc-card__body vz-publish__grid">
              <TextField
                label="اسم التطبيق"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <TextField
                label="رقم الإصدار"
                value={version}
                maxLength={40}
                mono
                onChange={(e) => setVersion(e.target.value)}
                required
              />
              <SelectField
                label="النظام"
                value={platform}
                options={PLATFORMS}
                onChange={(e) => {
                  setPlatform(e.target.value as Platform);
                  setFile(null);
                }}
              />
              <div className="vz-publish__source">
                {platform === "ios" ? (
                  <TextField
                    label="رابط App Store أو TestFlight"
                    value={appleUrl}
                    mono
                    onChange={(e) => setAppleUrl(e.target.value)}
                    required
                  />
                ) : (
                  <Upload
                    label="ملف التثبيت"
                    accept={ACCEPT[platform]}
                    constraintsText={`${ACCEPT[platform].replaceAll(",", " أو ")} · حتى 512 ميبيبايت`}
                    items={fileItem}
                    onFiles={(f) => setFile(f[0] ?? null)}
                    onRemove={() => setFile(null)}
                  />
                )}
              </div>
              {error ? (
                <Notice kind="error" title="لم يُنشر الإصدار">
                  <p className="acc-lead">{error}</p>
                </Notice>
              ) : null}
              <div className="acc-links">
                <Button
                  type="submit"
                  loading={busy}
                  disabledReason={
                    ready && !(file && file.size > MAX_BYTES)
                      ? undefined
                      : "أكمل الحقول واختر الملف"
                  }
                >
                  نشر للتجار
                </Button>
              </div>
            </div>
          </form>
        ) : null}
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">متجر التطبيقات</h2>
            <span className="cat-head__hint">
              {admin
                ? "الإصدارات المنشورة. السحب يحذف الملف ويُسجَّل في التدقيق."
                : "الإصدارات المنشورة — النشر والسحب لمدير المنصة."}
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" ? (
              <Notice kind="error" title="تعذّر تحميل التطبيقات">
                <div className="acc-links">
                  <Button onClick={() => void load()}>أعد المحاولة</Button>
                </div>
              </Notice>
            ) : null}
            {rows ? (
              <>
                <PlatformChips value={filter} onChange={setFilter} rows={rows} />
                <List
                  rows={rows}
                  filter={filter}
                  render={(r) => (
                    <ReleaseRow
                      key={r.id}
                      r={r}
                      details
                      action={
                        admin ? (
                          <Button variant="quiet" onClick={() => void remove(r)}>
                            سحب الإصدار
                          </Button>
                        ) : null
                      }
                    />
                  )}
                />
              </>
            ) : null}
            <p role="status" className="acc-choice__note">
              {message}
            </p>
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
