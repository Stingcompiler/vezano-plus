import { tx } from "@sting/texts";
import {
  AppText,
  Button,
  Chip,
  GroupedList,
  Screen,
  Sheet,
  SPACE,
  StateView,
  TextField,
} from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Actions, Heading, Item, Lead, Mono, N, Note, Strong, Word } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { shareText } from "./share";
import { ORG_TEXTS } from "./texts";
import { fetched, useReport } from "./use-report";

const T = "ORG-01";
type State = "ready" | "loading" | "empty" | "validation_error" | "expired" | "success";

export interface UserRow {
  id: string;
  display_name: string;
  is_owner: boolean;
  status: "active" | "disabled";
  roles: { code: string; name: string }[];
  branches: { id: string; name: string }[];
  all_branches: boolean;
  operations: number;
}
export interface InvitationRow {
  id: string;
  identifier_masked: string;
  role_code: string;
  role_name: string;
  branch_id: string;
  branch_name: string;
  status: "sent" | "expired" | "accepted" | "revoked";
  sent_at: string;
  expires_at: string;
  inviter_name: string;
}
export interface UsersPayload {
  users: UserRow[];
  invitations: InvitationRow[];
  counts: { users: number; open_invitations: number };
  invite_ttl_hours: number;
  branches: { id: string; name: string }[];
  roles: { id: string; code: string; name: string }[];
  can_invite: boolean;
}
interface Sent {
  invitation: InvitationRow;
  link: string;
  grants: string[];
}

const ddmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const STATUS_LABEL = {
  active: tx(T, "نشط"),
  disabled: tx(T, "معطَّل"),
  sent: tx(T, "دعوة مُرسَلة"),
  expired: tx(T, "منتهية"),
  accepted: tx(T, "مقبولة"),
  revoked: tx(T, "ملغاة"),
} as const;
const TONE = {
  active: "active",
  disabled: "disabled",
  sent: "sent",
  expired: "expired",
  accepted: "active",
  revoked: "disabled",
} as const;

/** نصّ خطأ الدعوة كما في الويب (`detail` من الخادم). */
export function inviteError(detail: string | undefined): string {
  return detail === "identifier_invalid"
    ? tx(T, "اكتب رقم هاتف أو بريداً صالحاً")
    : detail === "email_only"
      ? tx(T, "ادعُ الموظف ببريده — التسجيل بالهاتف غير متاح حالياً، إلا لمن له حساب قائم برقمه")
      : detail === "already_member"
        ? tx(T, "هذا المعرّف مستخدم في المنشأة أصلاً")
        : detail === "user_limit"
          ? tx(
              T,
              "بلغت حدّ المستخدمين في باقتك (مع الدعوات المعلّقة) — عطّل مستخدماً أو ألغِ دعوة أو رقِّ الباقة أو أضف مستخدماً من شاشة الاشتراك",
            )
          : tx(T, "تعذّر إرسال الدعوة");
}

function Dated({ iso }: { iso: string }) {
  return <N>{ddmm(iso)}</N>;
}

/**
 * ORG-01 — المستخدمون والدعوات (نظير `users-client.tsx`): الدعوة ليست حساباً والتعطيل ليس حذفاً؛
 * القائمة من الخادم دائماً لا من كاش؛ لا دعوة ثانية لمعرّف مدعوّ؛ المنتهية لا تُحيا بل تُصدر جديدة.
 * الدعوة تنتهي بورقة المشاركة الأصلية للرابط.
 */
export function Users() {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(
    async () => fetched<UsersPayload>(await api.GET("/api/org/users", {})),
    [api],
  );
  const { p: data, failed, reload } = useReport<UsersPayload>({ load });
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [roleId, setRoleId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<InvitationRow | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [focus, setFocus] = useState<InvitationRow | null>(null);

  const role = roleId || data?.roles[0]?.id || "";
  const branch = branchId || data?.branches[0]?.id || "";

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setInvalid(null);
    try {
      const {
        data: d,
        error,
        response,
      } = await api.POST("/api/org/invitations", {
        body: { identifier, role_id: role, branch_id: branch },
      });
      if (response.status === 409) {
        const e = error as unknown as { existing?: InvitationRow } | undefined;
        setDup(e?.existing ?? null);
        setOpen(false);
        return;
      }
      if (!response.ok || !d) {
        const e = error as unknown as { detail?: string } | undefined;
        setInvalid(inviteError(e?.detail));
        return;
      }
      setSent(d);
      setOpen(false);
      setIdentifier("");
      setFocus(null);
      await reload();
    } catch {
      setInvalid(tx(T, "تعذّر إرسال الدعوة"));
    } finally {
      setBusy(false);
    }
  };

  const act = async (inv: InvitationRow, action: "resend" | "revoke") => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: d, response } = await api.POST(
        "/api/org/invitations/{invitation_id}/{action}",
        {
          params: { path: { invitation_id: inv.id, action } },
        },
      );
      // «إعادة الإرسال» وحدها تعيد الرابط والمنح
      const b = d as unknown as Partial<Sent> | undefined;
      if (response.ok && action === "resend" && b?.link !== undefined && b.invitation)
        setSent({ invitation: b.invitation, link: b.link, grants: b.grants ?? [] });
      setDup(null);
      setFocus(null);
      await reload();
    } catch {
      /* لا تغيير — القائمة كما هي */
    } finally {
      setBusy(false);
    }
  };

  const users = data?.users ?? [];
  const invitations = data?.invitations ?? [];
  const alone = users.length <= 1 && invitations.length === 0;
  const state: State = !data
    ? "loading"
    : sent
      ? "success"
      : dup
        ? "validation_error"
        : focus?.status === "expired"
          ? "expired"
          : alone
            ? "empty"
            : "ready";

  const ttl = data?.invite_ttl_hours ?? 72;
  const userNote = (u: UserRow) =>
    u.is_owner ? (
      tx(T, "الحساب الوحيد الذي يرى الاشتراك والمبالغ. لا يُعطَّل إلا بنقل ملكية موثَّق.")
    ) : u.status === "disabled" ? (
      <>
        {tx(T, "معطَّل. لا يدخل ولا يبيع، ويبقى اسمه فاعلاً على")} <N>{u.operations}</N>{" "}
        {tx(T, "عملية نفّذها. التعطيل ليس حذفاً.")}
      </>
    ) : (
      tx(T, "الصلاحية تُمنح للدور، والنطاق يُمنح للمستخدم في الفرع.")
    );
  const invNote = (i: InvitationRow) =>
    i.status === "sent" ? (
      <>
        {tx(T, "الرابط صالح")} <N>{ttl}</N>{" "}
        {tx(T, "ساعة. حتى قبولها لا يوجد حساب ولا صلاحية ولا اسم في سجل التدقيق.")}
      </>
    ) : i.status === "expired" ? (
      tx(T, "انتهت المدة. لا تُحيا: نُصدر دعوة جديدة برابط جديد ويبقى أثر الأولى.")
    ) : i.status === "accepted" ? (
      tx(T, "قُبلت — صار للمدعوّ حساب بالدور والفرع المذكورين.")
    ) : (
      tx(T, "أُلغيت قبل قبولها. يبقى أثرها ومن أرسلها.")
    );

  const summary = (i: InvitationRow) => (
    <>
      {tx(T, "دعوة —")} {i.identifier_masked} · {i.role_name} · {i.branch_name} {tx(T, "· أُرسلت")}{" "}
      <Dated iso={i.sent_at} />
    </>
  );

  return (
    <Screen screenId={T} state={state} title={tx(T, "المستخدمون")} onRefresh={() => void reload()}>
      <AppText variant="section">{tx(T, "المستخدمون والدعوات")}</AppText>
      <Note>{tx(T, "من يدخل منشأتك وبأي دور.")}</Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "loading" ? (
        <StateView state="loading" title={tx(T, "جلب المستخدمين")}>
          <Lead>{tx(T, "القائمة من الخادم دائماً لا من كاش.")}</Lead>
          {failed ? (
            <Button
              variant="secondary"
              label={tx(T, "أعد المحاولة")}
              onPress={() => void reload()}
            />
          ) : null}
        </StateView>
      ) : null}

      {state === "empty" ? (
        <StateView state="empty" title={tx(T, "أنت وحدك")}>
          <Lead>{tx(T, "منشأة بمستخدم واحد.")}</Lead>
        </StateView>
      ) : null}

      {state === "validation_error" && dup ? (
        <StateView state="validation_error" title={tx(T, "دعوة لرقم مدعوّ أصلاً")}>
          <Lead>{tx(T, "الرقم عليه دعوة معلّقة لم تُقبل بعد.")}</Lead>
          <Note>{summary(dup)}</Note>
          <Actions>
            <Button
              label={tx(T, "أعد إرسالها")}
              loading={busy}
              onPress={() => void act(dup, "resend")}
            />
            <Button
              variant="secondary"
              label={tx(T, "ألغِها")}
              loading={busy}
              onPress={() => void act(dup, "revoke")}
            />
          </Actions>
        </StateView>
      ) : null}

      {state === "expired" && focus ? (
        <StateView state="expired" title={tx(T, "دعوة منتهية")}>
          <Lead>
            <Strong>{tx(T, "الدعوة المنتهية لا تُحيا بضغطة.")}</Strong>{" "}
            {tx(
              T,
              "نُصدر دعوة جديدة برابط جديد وصلاحية جديدة، ويبقى أثر الدعوة الأولى ومن أرسلها. الرابط المنتهي لو استُعمل يعرض «انتهت صلاحية الدعوة — اطلب دعوة جديدة من المالك» ولا يُنشئ حساباً معلّقاً.",
            )}
          </Lead>
          <Note>{summary(focus)}</Note>
          <Button
            label={tx(T, "إصدار دعوة جديدة")}
            loading={busy}
            onPress={() => void act(focus, "resend")}
          />
        </StateView>
      ) : null}

      {state === "success" && sent ? (
        <StateView state="success" title={tx(T, "أُرسلت الدعوة")}>
          <Note>
            {tx(T, "دعوة —")} {sent.invitation.identifier_masked} · {sent.invitation.role_name} ·{" "}
            {sent.invitation.branch_name} {tx(T, "· الرابط صالح")} <N>{ttl}</N> {tx(T, "ساعة")}
          </Note>
          {sent.grants.map((g) => (
            <Note key={g}>
              <Mono text={g} />
            </Note>
          ))}
          <Note>
            {tx(T, "رابط الدعوة:")} <N>{sent.link}</N>
          </Note>
          <Actions>
            <Button
              label={ORG_TEXTS.shareLink}
              onPress={() => void shareText(sent.link, tx(T, "دعوة مستخدم"))}
            />
            <Button variant="secondary" label={tx(T, "حسناً")} onPress={() => setSent(null)} />
          </Actions>
        </StateView>
      ) : null}

      {data ? (
        <>
          <Heading>
            {tx(T, "المستخدمون —")} <N>{data.counts.users}</N> {tx(T, "· دعوات مفتوحة")}{" "}
            <N>{data.counts.open_invitations}</N>
          </Heading>
          <Button
            label={tx(T, "دعوة مستخدم")}
            disabledReason={data.can_invite ? undefined : tx(T, "الدعوة للمالك ومدير الفرع")}
            onPress={() => {
              setSent(null);
              setDup(null);
              setFocus(null);
              setOpen(true);
            }}
          />
          <View style={{ height: SPACE["3"] }} />
        </>
      ) : null}

      {data && !alone ? (
        <>
          <GroupedList title={tx(T, "المستخدمون والدعوات")}>
            {users.map((u, i) => (
              <Item
                key={`u-${u.id}`}
                title={u.display_name}
                status={<Word tone={TONE[u.status]}>{STATUS_LABEL[u.status]}</Word>}
                last={i === users.length - 1 && invitations.length === 0}
              >
                {u.is_owner ? <Note>{tx(T, "مالك المنشأة")}</Note> : null}
                <AppText variant="secondary">
                  {u.roles.map((x) => x.name).join(tx(T, "،") + " ") || "—"}
                  {u.status === "disabled" ? ` ${tx(T, "— سابقاً")}` : ""}
                </AppText>
                <Note>
                  {u.all_branches
                    ? tx(T, "كل الفروع")
                    : u.branches.map((b) => b.name).join(tx(T, "،") + " ") || "—"}
                </Note>
                <Note>{userNote(u)}</Note>
                {!u.is_owner && u.status === "active" ? (
                  <Actions>
                    <Button
                      variant="quiet"
                      label={tx(T, "سحب الوصول")}
                      onPress={() =>
                        router.push({ pathname: "/org/users/[id]/revoke", params: { id: u.id } })
                      }
                    />
                  </Actions>
                ) : null}
              </Item>
            ))}
            {invitations.map((i, idx) => (
              <Item
                key={`i-${i.id}`}
                title={`${tx(T, "دعوة —")} ${i.identifier_masked}`}
                status={<Word tone={TONE[i.status]}>{STATUS_LABEL[i.status]}</Word>}
                last={idx === invitations.length - 1}
              >
                <Note>
                  {tx(T, "أُرسلت")} <Dated iso={i.sent_at} />
                </Note>
                <AppText variant="secondary">{i.role_name}</AppText>
                <Note>{i.branch_name}</Note>
                <Note>{invNote(i)}</Note>
                {i.status === "sent" ? (
                  <Actions>
                    <Button
                      variant="quiet"
                      label={tx(T, "أعد إرسالها")}
                      loading={busy}
                      onPress={() => void act(i, "resend")}
                    />
                    <Button
                      variant="quiet"
                      label={tx(T, "ألغِها")}
                      loading={busy}
                      onPress={() => void act(i, "revoke")}
                    />
                  </Actions>
                ) : null}
                {i.status === "expired" ? (
                  <Actions>
                    <Button
                      variant="quiet"
                      label={tx(T, "دعوة منتهية")}
                      onPress={() => setFocus(i)}
                    />
                  </Actions>
                ) : null}
              </Item>
            ))}
          </GroupedList>
          <Note>
            <Strong>{tx(T, "الدعوة المنتهية لا تُحيا بضغطة.")}</Strong>{" "}
            {tx(
              T,
              "نُصدر دعوة جديدة برابط جديد وصلاحية جديدة، ويبقى أثر الدعوة الأولى ومن أرسلها. الرابط المنتهي لو استُعمل يعرض «انتهت صلاحية الدعوة — اطلب دعوة جديدة من المالك» ولا يُنشئ حساباً معلّقاً.",
            )}
          </Note>
        </>
      ) : null}

      <View style={{ height: SPACE["3"] }} />
      <Button
        variant="quiet"
        label={tx(T, "مصفوفة الأدوار والصلاحيات")}
        onPress={() => router.push("/org/roles")}
      />

      <Sheet open={open} title={tx(T, "دعوة مستخدم")} onClose={() => setOpen(false)}>
        <TextField
          label={tx(T, "رقم الهاتف أو البريد")}
          value={identifier}
          onChangeText={setIdentifier}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          required
          mono
        />
        <AppText variant="bodyStrong">{tx(T, "الدور")}</AppText>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: SPACE["2"],
            marginBottom: SPACE["3"],
          }}
        >
          {(data?.roles ?? []).map((r) => (
            <Chip key={r.id} label={r.name} on={role === r.id} onPress={() => setRoleId(r.id)} />
          ))}
        </View>
        <AppText variant="bodyStrong">{tx(T, "الفرع")}</AppText>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: SPACE["2"],
            marginBottom: SPACE["3"],
          }}
        >
          {(data?.branches ?? []).map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              on={branch === b.id}
              onPress={() => setBranchId(b.id)}
            />
          ))}
        </View>
        <Note>
          {tx(T, "الرابط صالح")} <N>{ttl}</N>{" "}
          {tx(T, "ساعة. حتى قبولها لا يوجد حساب ولا صلاحية ولا اسم في سجل التدقيق.")}
        </Note>
        {invalid ? (
          <AppText
            variant="note"
            style={{ marginTop: SPACE["2"] }}
            accessibilityLiveRegion="polite"
          >
            {invalid}
          </AppText>
        ) : null}
        <View style={{ height: SPACE["3"] }} />
        <Button
          label={tx(T, "إرسال الدعوة")}
          loading={busy}
          disabledReason={identifier.trim() ? undefined : tx(T, "اكتب رقم هاتف أو بريداً صالحاً")}
          onPress={() => void submit()}
        />
      </Sheet>
    </Screen>
  );
}
