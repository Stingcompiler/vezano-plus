import { createApiClient } from "@sting/app-core";
import { DEVICE_SETUP_KEY } from "@sting/sync-core";
import { tx } from "@sting/texts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { SECRET_KEYS, secrets } from "@/lib/secrets";
import { getStorage } from "@/lib/storage";
import { WEB_URL } from "@/lib/web";

/**
 * جلسة الجوال (خطة الجوال M1؛ 0005 §١٧٢–§١٧٣).
 * - الدخول واختيار المنشأة يعطيان جلسة مستخدم في الذاكرة (تجديدها بـ`/api/auth/refresh` كالويب).
 * - تجهيز الجهاز (ACC-05) يسجّله ويحوّل الجلسة إلى جلسة جهاز، ويصدر رمز التجديد الطويل (§١٦٢)
 *   فيُحفظ في المخزن الآمن مع معرّف الجهاز.
 * - فتح التطبيق بعد إغلاقه: جهاز مجهّز برمز محفوظ = القفل (ACC-07)؛ الرمز الصحيح يدوّر رمز الجهاز
 *   فتعود الجلسة بلا كلمة مرور، وبلا شبكة يعمل التطبيق محلياً حتى تعود.
 * - الخمول: العودة من الخلفية بعد `IDLE_LOCK_MINUTES` تقفل (كقفل الخمول في الويب §١٢٠).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? WEB_URL;

export interface Tokens {
  readonly access: string;
  readonly refresh: string;
  readonly sessionId: string;
}

export interface Membership {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly role_name: string;
  readonly scope: string;
  readonly status: "active" | "suspended";
}

export type SessionStatus = "booting" | "anonymous" | "selecting" | "locked" | "active";

/** كالويب (`IDLE_LOCK_MINUTES`) — العودة من الخلفية بعدها تقفل. */
export const IDLE_LOCK_MINUTES = 20;

export interface SessionState {
  readonly status: SessionStatus;
  readonly tokens: Tokens | null;
  readonly userId: string | null;
  readonly tenantId: string | null;
  /** بعد الدخول بعضويات متعدّدة: تذكرة اختيار المنشأة (ACC-03) وقائمتها */
  readonly selection: {
    readonly ticket: string;
    readonly memberships: readonly Membership[];
  } | null;
  /** انتهت الجلسة ولم يُستأنف التجديد (ACC-08) */
  readonly expired: boolean;
  /** نُزّلت نسخة المنشأة على هذا الهاتف وفُعّلت (ACC-05) */
  readonly setupDone: boolean;
  /** جلسة جهاز مسجَّل برمز تجديد محفوظ — شرط القفل والاستئناف */
  readonly deviceId: string | null;
  /** فُتح القفل بلا شبكة: يعمل محلياً حتى يعود الاتصال */
  readonly offline: boolean;
}

export const ANONYMOUS: SessionState = {
  status: "anonymous",
  tokens: null,
  userId: null,
  tenantId: null,
  selection: null,
  expired: false,
  setupDone: false,
  deviceId: null,
  offline: false,
};

export const BOOTING: SessionState = { ...ANONYMOUS, status: "booting" };

/** ردّ `POST /api/auth/account/login` و`/api/account/select` بالحقول التي يقرؤها الجوال. */
export interface SignInPayload {
  readonly access?: string | null;
  readonly refresh?: string | null;
  readonly session_id?: string | null;
  readonly user_id?: string | null;
  readonly tenant_id?: string | null;
  readonly select_ticket?: string | null;
  /** خيارات الدخول المختصرة — تُحوَّل إلى صفوف ACC-03 كما يفعل الويب (`fromOption`) */
  readonly memberships?: readonly LoginOption[] | null;
}

export interface LoginOption {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly is_owner: boolean;
}

export function fromOption(o: LoginOption): Membership {
  return {
    user_id: o.user_id,
    tenant_id: o.tenant_id,
    tenant_name: o.tenant_name,
    role_name: o.is_owner ? tx("ACC-03", "مالك") : "",
    scope: o.is_owner ? tx("ACC-03", "كل الفروع") : "",
    status: "active",
  };
}

/** انتقال الجلسة بعد الدخول أو اختيار المنشأة — دالة نقية تُختبر وحدها. */
export function afterSignIn(prev: SessionState, data: SignInPayload): SessionState {
  if (data.access && data.refresh && data.session_id) {
    return {
      ...prev,
      status: "active",
      tokens: { access: data.access, refresh: data.refresh, sessionId: data.session_id },
      userId: data.user_id ?? prev.userId,
      tenantId: data.tenant_id ?? prev.tenantId,
      selection: null,
      expired: false,
      // جلسة مستخدم جديدة — جلسة الجهاز السابقة (إن وُجدت) تُستبدل بالتجهيز
      deviceId: null,
      offline: false,
    };
  }
  return {
    ...ANONYMOUS,
    setupDone: prev.setupDone,
    status: "selecting",
    selection: {
      ticket: data.select_ticket ?? "",
      memberships: (data.memberships ?? []).map(fromOption),
    },
  };
}

/** ردّ تسجيل الجهاز (`/api/devices/register` أو `/renew`) بالحقول التي يحتاجها الاستئناف. */
export interface DeviceRegistration {
  readonly device_id: string;
  readonly access: string;
  readonly refresh: string;
}

interface DeviceRefreshed {
  readonly access: string;
  readonly refresh_token: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly device_id: string;
}

type Unlock = "unlocked" | "offline" | "revoked";

interface SessionApi {
  readonly state: SessionState;
  readonly api: ReturnType<typeof createApiClient>;
  readonly signIn: (data: SignInPayload) => SessionState;
  readonly signOut: () => void;
  /** بعد تسجيل الجهاز: جلسة جهاز + رمز التجديد الطويل في المخزن الآمن */
  readonly adoptDevice: (reg: DeviceRegistration) => Promise<void>;
  readonly completeSetup: () => void;
  readonly lock: () => void;
  /** بعد PIN صحيح لمستخدم: يعيد الجلسة (أو يدوّر رمز الجهاز بعد إغلاق التطبيق) */
  readonly unlock: (userId: string) => Promise<Unlock>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({
  children,
  initial = BOOTING,
  fetchImpl,
  idleMinutes = IDLE_LOCK_MINUTES,
}: {
  children: ReactNode;
  initial?: SessionState;
  /** للاختبار */
  fetchImpl?: typeof fetch;
  idleMinutes?: number;
}) {
  const [state, setState] = useState<SessionState>(initial);
  const ref = useRef(state);
  ref.current = state;
  const doFetch = fetchImpl ?? fetch;

  const set = useCallback((next: SessionState) => {
    ref.current = next;
    setState(next);
  }, []);

  const post = useCallback(
    async <T,>(path: string, body: unknown): Promise<{ status: number; data: T | null }> => {
      const res = await doFetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
    },
    [doFetch],
  );

  /** يدوّر رمز الجهاز المحفوظ: رمز جديد يُحفظ، والمرفوض (مسحوب/مُعاد) يُمحى. */
  const rotateDevice = useCallback(async (): Promise<DeviceRefreshed | "rejected" | null> => {
    const [token, deviceId] = await Promise.all([
      secrets().get(SECRET_KEYS.deviceRefresh),
      secrets().get(SECRET_KEYS.deviceId),
    ]);
    if (!token || !deviceId) return "rejected";
    const r = await post<DeviceRefreshed>("/api/auth/device-refresh", {
      refresh_token: token,
      device_id: deviceId,
    });
    if (r.status === 401) {
      await secrets().delete(SECRET_KEYS.deviceRefresh);
      return "rejected";
    }
    if (!r.data) return null;
    await secrets().set(SECRET_KEYS.deviceRefresh, r.data.refresh_token);
    return r.data;
  }, [post]);

  const fromDevice = useCallback(
    (d: DeviceRefreshed): SessionState => ({
      ...ref.current,
      status: "active",
      tokens: { access: d.access, refresh: "", sessionId: d.session_id },
      userId: d.user_id,
      tenantId: d.tenant_id,
      deviceId: d.device_id,
      selection: null,
      expired: false,
      offline: false,
    }),
    [],
  );

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_URL,
        getAccessToken: () => ref.current.tokens?.access ?? null,
        fetch: fetchImpl,
        resume: async () => {
          // جلسة جهاز: تدوير رمزه الطويل؛ وإلا تجديد جلسة المستخدم كالويب
          if (ref.current.deviceId) {
            const d = await rotateDevice().catch(() => null);
            if (!d || d === "rejected") return null;
            set(fromDevice(d));
            return { access: d.access };
          }
          const refresh = ref.current.tokens?.refresh;
          if (!refresh) return null;
          const r = await post<{ access: string; refresh: string; session_id: string }>(
            "/api/auth/refresh",
            { refresh },
          ).catch(() => null);
          if (!r?.data) return null;
          set({
            ...ref.current,
            tokens: {
              access: r.data.access,
              refresh: r.data.refresh,
              sessionId: r.data.session_id,
            },
          });
          return { access: r.data.access };
        },
        onUnauthorized: () =>
          set({ ...ANONYMOUS, setupDone: ref.current.setupDone, expired: true }),
      }),
    [fetchImpl, fromDevice, post, rotateDevice, set],
  );

  // الإقلاع: جهاز مجهّز برمز محفوظ = القفل؛ وإلا الترحيب
  useEffect(() => {
    if (initial.status !== "booting") return;
    let cancelled = false;
    void (async () => {
      const [token, deviceId, setup] = await Promise.all([
        secrets()
          .get(SECRET_KEYS.deviceRefresh)
          .catch(() => null),
        secrets()
          .get(SECRET_KEYS.deviceId)
          .catch(() => null),
        getStorage()
          .then((st) => st.read((tx) => tx.getMeta(DEVICE_SETUP_KEY)))
          .catch(() => null),
      ]);
      if (cancelled) return;
      const setupDone = setup === "done";
      set(
        setupDone && token && deviceId
          ? { ...ANONYMOUS, status: "locked", setupDone, deviceId }
          : { ...ANONYMOUS, setupDone },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [initial.status, set]);

  // قفل الخمول: العودة من الخلفية بعد المهلة تقفل جلسة نشطة على جهاز مجهّز
  useEffect(() => {
    let since = 0;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") since = Date.now();
      if (s === "active" && since) {
        const idle = Date.now() - since >= idleMinutes * 60_000;
        since = 0;
        const cur = ref.current;
        if (idle && cur.status === "active" && cur.setupDone && cur.deviceId) {
          set({ ...cur, status: "locked" });
        }
      }
    });
    return () => sub.remove();
  }, [idleMinutes, set]);

  const signIn = useCallback(
    (data: SignInPayload) => {
      const next = afterSignIn(ref.current, data);
      set(next);
      return next;
    },
    [set],
  );

  const signOut = useCallback(() => {
    const access = ref.current.tokens?.access;
    // إلغاء الجلسة على الخادم (ACC-09) برمزها صراحةً — لا ننتظره: الخروج محلياً فوري
    if (access) {
      void api
        .POST("/api/auth/logout", { headers: { Authorization: `Bearer ${access}` } })
        .catch(() => undefined);
    }
    // الإلغاء يُبطل سلسلة رمز الجهاز على الخادم — فيُمحى هنا أيضاً
    void secrets()
      .delete(SECRET_KEYS.deviceRefresh)
      .catch(() => undefined);
    set({ ...ANONYMOUS, setupDone: ref.current.setupDone });
  }, [api, set]);

  const adoptDevice = useCallback(
    async (reg: DeviceRegistration) => {
      // رمز التجديد JWT من التسجيل يُستهلك مرة: يصدر الرمز الطويل المربوط بالجهاز
      const r = await post<DeviceRefreshed>("/api/auth/device-refresh/issue", {
        refresh: reg.refresh,
      }).catch(() => null);
      if (r?.data) {
        await secrets().set(SECRET_KEYS.deviceRefresh, r.data.refresh_token);
        await secrets().set(SECRET_KEYS.deviceId, r.data.device_id);
        await secrets().set(SECRET_KEYS.userId, r.data.user_id);
        set(fromDevice(r.data));
        return;
      }
      // تعذّر الإصدار: جلسة الجهاز لهذا التشغيل وحده (بلا استئناف بعد الإغلاق)
      set({
        ...ref.current,
        tokens: { access: reg.access, refresh: reg.refresh, sessionId: "" },
        deviceId: reg.device_id,
      });
    },
    [fromDevice, post, set],
  );

  const completeSetup = useCallback(() => set({ ...ref.current, setupDone: true }), [set]);

  const lock = useCallback(() => {
    if (ref.current.status === "active") set({ ...ref.current, status: "locked" });
  }, [set]);

  const unlock = useCallback(
    async (userId: string): Promise<Unlock> => {
      const cur = ref.current;
      // جلسة حيّة في الذاكرة (قفل الخمول): تعود كما هي
      if (cur.tokens && cur.userId === userId) {
        set({ ...cur, status: "active" });
        return "unlocked";
      }
      try {
        const d = await rotateDevice();
        if (d === "rejected") {
          set({ ...ANONYMOUS, setupDone: cur.setupDone });
          return "revoked";
        }
        if (d) {
          set(fromDevice(d));
          return "unlocked";
        }
      } catch {
        /* بلا شبكة */
      }
      // بلا شبكة: محلياً حتى يعود الاتصال (الرمز صحيح والدفتر على الجهاز)
      set({ ...cur, status: "active", userId, offline: true });
      return "offline";
    },
    [fromDevice, rotateDevice, set],
  );

  const value = useMemo(
    () => ({ state, api, signIn, signOut, adoptDevice, completeSetup, lock, unlock }),
    [state, api, signIn, signOut, adoptDevice, completeSetup, lock, unlock],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession خارج SessionProvider");
  return v;
}
