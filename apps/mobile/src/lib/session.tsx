import { createApiClient } from "@sting/app-core";
import { tx } from "@sting/texts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { WEB_URL } from "@/lib/web";

/**
 * جلسة الجوال (خطة الجوال M1 — الدخول والقشرة؛ 0005 §١٧٢). الرموز في الذاكرة في هذه الخطوة: الدخول
 * وتجديد الوصول برمز التجديد (`/api/auth/refresh`) كالويب. الاستئناف بعد إغلاق التطبيق يحتاج جهازاً
 * مسجَّلاً — رمز التجديد الطويل (§١٦٢) يُصدر من جلسة جهاز — فيأتي مع تجهيز الجهاز (ACC-05) والمخزن
 * الآمن في الخطوة التالية.
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

export type SessionStatus = "anonymous" | "selecting" | "active";

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
}

export const ANONYMOUS: SessionState = {
  status: "anonymous",
  tokens: null,
  userId: null,
  tenantId: null,
  selection: null,
  expired: false,
};

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
      status: "active",
      tokens: { access: data.access, refresh: data.refresh, sessionId: data.session_id },
      userId: data.user_id ?? prev.userId,
      tenantId: data.tenant_id ?? prev.tenantId,
      selection: null,
      expired: false,
    };
  }
  return {
    ...ANONYMOUS,
    status: "selecting",
    selection: {
      ticket: data.select_ticket ?? "",
      memberships: (data.memberships ?? []).map(fromOption),
    },
  };
}

interface SessionApi {
  readonly state: SessionState;
  readonly api: ReturnType<typeof createApiClient>;
  readonly signIn: (data: SignInPayload) => SessionState;
  readonly signOut: () => void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({
  children,
  initial = ANONYMOUS,
  fetchImpl,
}: {
  children: ReactNode;
  initial?: SessionState;
  /** للاختبار */
  fetchImpl?: typeof fetch;
}) {
  const [state, setState] = useState<SessionState>(initial);
  const ref = useRef(state);
  ref.current = state;

  const set = useCallback((next: SessionState) => {
    ref.current = next;
    setState(next);
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_URL,
        getAccessToken: () => ref.current.tokens?.access ?? null,
        fetch: fetchImpl,
        // تجديد الوصول كالويب: رمز التجديد يدوَّر مع كل استعمال
        resume: async () => {
          const refresh = ref.current.tokens?.refresh;
          if (!refresh) return null;
          const res = await (fetchImpl ?? fetch)(`${API_URL}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh }),
          }).catch(() => null);
          if (!res?.ok) return null;
          const body = (await res.json()) as {
            access: string;
            refresh: string;
            session_id: string;
          };
          set({
            ...ref.current,
            tokens: { access: body.access, refresh: body.refresh, sessionId: body.session_id },
          });
          return { access: body.access };
        },
        onUnauthorized: () => set({ ...ANONYMOUS, expired: true }),
      }),
    [fetchImpl, set],
  );

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
    set(ANONYMOUS);
  }, [api, set]);

  const value = useMemo(() => ({ state, api, signIn, signOut }), [state, api, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession خارج SessionProvider");
  return v;
}
