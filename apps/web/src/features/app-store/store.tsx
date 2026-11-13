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
import {
  operatorFetch,
  operatorRole,
  operatorToken,
  renewOperatorAfter401,
} from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";
import { apiBaseUrl, apiFetch, getAccessToken } from "@/lib/api";

import { LINK_ICONS, LinkIconMark } from "./link-icon";
import { PlatformIcon, type Platform } from "./platform-icon";

/**
 * متجر التطبيقات (0005 §٢١٥): الإصدارات صفوف لا بطاقات، والنظام مرشّح واحد. ثلاثة مداخل:
 * - الصفحة العامة: الاسم والنظام والإصدار فقط، و«سجّل الدخول للتنزيل».
 * - التاجر (ORG-11): ينزّل الملف برابط موقَّع قصير العمر بمدير تنزيلات المتصفح، ويرى الحجم (البصمة لا تُعرض — §٢٢٥).
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
  /** ملف تثبيت يُنزَّل بجلسة تاجر، أو رابط بتسمية وأيقونة منصة يفتحه أيّ أحد (§٢٣٠) */
  kind?: "file" | "link";
  link_url?: string;
  link_label?: string;
  link_icon?: string;
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
  link_invalid: "أدخل رابطاً كاملاً يبدأ بـ https://",
  link_label_required: "اكتب تسمية للرابط، مثل «حمّل من Google Play».",
  link_icon_invalid: "اختر أيقونة من القائمة.",
  file_or_link: "انشر ملفاً أو رابطاً، لا الاثنين معاً.",
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

const getPublicJson = (path: string) => getJson(path, null);
// 0005 §٢٧٢ — 401 يُستأنف ويُعاد؛ انتهاء الجلسة فعلاً يمرّ بمعالج ACC-08 المشترك
const getOrgJson = (path: string) => orgFetch(path, { cache: "no-store" });

/**
 * 0005 §٢٧٤ — 401 لطلب أُرسل بلا رمز = لا جلسة أصلاً (`apiFetch` لا يستأنف ولا يستدعي ACC-08).
 * يُحكم عليه عند الإرسال لا بعد الردّ: معالج ACC-08 يمسح الرمز حين تنتهي جلسة فعلاً، فالسؤال «هل
 * يوجد رمز الآن؟» كان يحوّل تلك الحالة إلى الدخول فوق «انتهت الجلسة».
 */
const SENT_WITHOUT_SESSION = new WeakSet<Response>();
async function orgFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const anonymous = !getAccessToken();
  const res = await apiFetch(path, init);
  if (anonymous && res.status === 401) SENT_WITHOUT_SESSION.add(res);
  return res;
}
const getOperatorJson = (path: string) => operatorFetch(path, { cache: "no-store" });

function useCatalog(
  path: string,
  get: (path: string) => Promise<Response>,
  onUnauthorized?: (res: Response) => void,
) {
  const [rows, setRows] = useState<Release[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await get(path);
      if (r.status === 401) {
        onUnauthorized?.(r);
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as { releases: Release[] };
      setRows(body.releases);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [path, get, onUnauthorized]);
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
      <span className="vz-app__icon">
        {r.kind === "link" ? (
          <LinkIconMark icon={r.link_icon ?? "website"} size={30} />
        ) : (
          <PlatformIcon platform={r.platform} size={30} />
        )}
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
      </div>
      <div className="vz-app__action">{action}</div>
    </li>
  );
}

/** زرّ رابط المنصة الأخرى: يُفتح في تبويب جديد، بأيقونتها وتسمية المشغّل. */
function LinkButton({
  r,
  variant = "secondary",
}: {
  r: Release;
  variant?: "primary" | "secondary";
}) {
  return (
    <a
      href={r.link_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`c-btn c-btn--${variant} vz-app__link`}
    >
      <LinkIconMark icon={r.link_icon ?? "website"} size={18} />
      {r.link_label || "فتح الرابط"}
    </a>
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

/**
 * قسم الصفحة الرئيسية: تصفّح بلا جلسة، والتنزيل بعد الدخول. يبقى القسم حاضراً دائماً لأن رابط الشريط
 * العام يقود إليه (§٢٢٤): بلا إصدارات أو مع تعذّر التحميل يقول ذلك بدل أن يختفي.
 */
export function PublicAppsSection() {
  const { rows, failed } = useCatalog("/api/public/apps", getPublicJson);
  const [filter, setFilter] = useState<Platform | "">("");
  return (
    <section id="lp-apps" className="lp__section" aria-labelledby="lp-apps-title">
      <div className="lp__wrap">
        <div className="lp__center">
          <h2 id="lp-apps-title">متجر التطبيقات</h2>
          <p className="lp__lead">
            نسخ فيزانو لأندرويد وآيفون وويندوز وماك. تصفّحها هنا، وتنزّلها من حسابك بعد الدخول.
          </p>
        </div>
        {failed ? (
          <div className="vz-apps__box">
            <Notice kind="warning" title="تعذّر تحميل الإصدارات الآن">
              <p className="acc-lead">أعد تحميل الصفحة بعد قليل.</p>
            </Notice>
          </div>
        ) : rows && rows.length === 0 ? (
          <div className="vz-apps__box">
            <Notice kind="empty" title="لا إصدارات منشورة بعد">
              <p className="acc-lead">تظهر هنا فور نشرها.</p>
            </Notice>
          </div>
        ) : rows ? (
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
                    r.kind === "link" ? (
                      <LinkButton r={r} />
                    ) : (
                      <Link href="/login?next=%2Forg%2Fapps" className="c-btn c-btn--secondary">
                        سجّل الدخول للتنزيل
                      </Link>
                    )
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
  // 0005 §٢٧٣ — بلا جلسة أصلاً: الدخول بوجهة العودة بدل «جارٍ التحميل» إلى الأبد. جلسة انتهت فعلاً
  // يتولاها معالج ACC-08 («انتهت الجلسة») ولا تُحوَّل إلى الدخول (§٢٧٤).
  const goLogin = useCallback(
    (res: Response) => {
      if (SENT_WITHOUT_SESSION.has(res)) router.replace("/login?next=/org/apps");
    },
    [router],
  );
  const { rows, failed, load } = useCatalog("/api/org/apps", getOrgJson, goLogin);
  const [filter, setFilter] = useState<Platform | "">("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const download = async (r: Release) => {
    setBusyId(r.id);
    setMessage("");
    try {
      const res = await orgFetch(`/api/org/apps/${r.id}/link`, { method: "POST" });
      if (res.status === 401) return goLogin(res);
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      // مدير تنزيلات المتصفح يتولّى الملف: لا يُحمَّل في ذاكرة الصفحة
      window.location.assign(apiBaseUrl() + url);
      setMessage(`بدأ تنزيل ${r.filename ?? r.name}.`);
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
                        r.kind === "link" ? (
                          <LinkButton r={r} />
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
  // 0005 §٢٧١ — 401 يُستأنف ويُعاد؛ انتهاء الجلسة فعلاً يقود إلى الدخول بوجهة العودة (الحاجز)
  const { rows, setRows, failed, load } = useCatalog("/api/platform/apps", getOperatorJson);
  const [filter, setFilter] = useState<Platform | "">("");
  const [platform, setPlatform] = useState<Platform>("android");
  const [name, setName] = useState("Vezano Plus");
  const [version, setVersion] = useState("");
  const [source, setSource] = useState<"file" | "link">("file");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkIcon, setLinkIcon] = useState<string>("google_play");
  // آيفون رابط دائماً: لا تثبيت لملف خارج App Store
  const asLink = platform === "ios" || source === "link";
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
    if (asLink) {
      body.set("link_url", linkUrl.trim());
      body.set("link_label", linkLabel.trim());
      body.set("link_icon", linkIcon);
    } else if (file) body.set("file", file);
    setBusy(true);
    // XHR لا fetch: تقدّم رفع ملف كبير على شبكة بطيئة
    const send = (access: string, retry: boolean) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${apiBaseUrl()}/api/platform/apps`);
      xhr.setRequestHeader("Authorization", `Bearer ${access}`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onloadend = () => {
        // 0005 §٢٧١ — رمز انتهى عمره أثناء ملء النموذج: يُستأنف مرة ويُعاد الرفع نفسه
        if (xhr.status === 401 && retry) {
          void renewOperatorAfter401().then((fresh) => {
            if (fresh) send(fresh, false);
            else {
              setBusy(false);
              setProgress(undefined);
            }
          });
          return;
        }
        done(xhr);
      };
      xhr.send(body);
    };
    const done = (xhr: XMLHttpRequest) => {
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
        setLinkUrl("");
        void load();
      } else if (xhr.status === 401) goLogin();
      else setError(ERRORS[detail] ?? "تعذّر النشر. تحقّق من الاتصال وأعد المحاولة.");
    };
    send(operatorToken() ?? "", true);
  };

  const remove = async (r: Release) => {
    if (
      !window.confirm(
        `سحب ${r.name} ${r.platform_label} ${r.version}؟ يُحذف ملفه ولا يعود متاحاً للتجار.`,
      )
    )
      return;
    const res = await operatorFetch(`/api/platform/apps/${r.id}/remove`, { method: "POST" });
    if (res.ok) {
      setRows(((await res.json()) as { releases: Release[] }).releases);
      setMessage("سُحب الإصدار.");
    } else setError("تعذّر سحب الإصدار.");
  };

  const ready = Boolean(
    name.trim() && version.trim() && (asLink ? linkUrl.trim() && linkLabel.trim() : file),
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
              {platform === "ios" ? null : (
                <div className="pos-chips vz-publish__kind" role="radiogroup" aria-label="المصدر">
                  {(
                    [
                      ["file", "رفع ملف التثبيت"],
                      ["link", "رابط من منصة أخرى"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={source === k}
                      className={`pos-chip${source === k ? " pos-chip--on" : ""}`}
                      onClick={() => {
                        setSource(k);
                        setFile(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <div className="vz-publish__source">
                {asLink ? (
                  <div className="vz-publish__link">
                    <TextField
                      label="الرابط"
                      value={linkUrl}
                      mono
                      inputMode="url"
                      placeholder="https://"
                      maxLength={500}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      required
                    />
                    <TextField
                      label="تسمية الزرّ"
                      value={linkLabel}
                      maxLength={80}
                      hint="ما يراه الزائر والتاجر، مثل «حمّل من Google Play»."
                      onChange={(e) => setLinkLabel(e.target.value)}
                      required
                    />
                    <fieldset className="vz-icons">
                      <legend>أيقونة المنصة</legend>
                      <div className="vz-icons__grid" role="radiogroup" aria-label="أيقونة المنصة">
                        {LINK_ICONS.map((ic) => (
                          <button
                            key={ic.value}
                            type="button"
                            role="radio"
                            aria-checked={linkIcon === ic.value}
                            className={`vz-icons__opt${linkIcon === ic.value ? " vz-icons__opt--on" : ""}`}
                            onClick={() => setLinkIcon(ic.value)}
                          >
                            <LinkIconMark icon={ic.value} size={20} />
                            <span>{ic.label}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </div>
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
                      : asLink
                        ? "أكمل الرابط وتسميته"
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
