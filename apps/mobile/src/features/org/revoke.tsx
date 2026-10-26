import { agoParts } from "@sting/app-core";
import { MOBILE_TEXTS, tx } from "@sting/texts";
import { AppText, Button, Screen, SPACE, StateView, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Actions, Choice, Heading, Lead, N, Note, Strong } from "@/components/org/ui";
import { useSession } from "@/lib/session";

import { fetched, useReport } from "./use-report";

const T = "ORG-05";
type State = "ready" | "validation_error" | "permission_denied" | "pending_sync" | "success";

export interface Preview {
  user: {
    id: string;
    display_name: string;
    is_owner: boolean;
    status: "active" | "disabled";
    deactivated_at: string;
  };
  scopes: { branch_id: string; branch_name: string; role_name: string; in_actor_scope: boolean }[];
  devices: {
    id: string;
    name: string;
    branch_name: string;
    status: string;
    pending: number;
    shared_with: string[];
  }[];
  pending_total: number;
  ledger: {
    invoices: number;
    shifts: number;
    open_shift: { id: string; opened_at: string; branch_name: string } | null;
  };
  can: { disable_user: boolean; revoke_branch: boolean; wipe_device: boolean };
  blockers: string[];
}
interface Result extends Preview {
  action: "disable" | "revoke_branch" | "wipe_device";
  sessions_ended?: number;
  sessions_deferred?: number;
  remaining_branches?: string[];
}
type Choose = "now" | "after_upload" | "wipe";

/** «عملية واحدة معلّقة» / «عمليتان معلقتان» / «N عمليات معلّقة» — الرقم mono والكلمة خارجه. */
export function Pending({ n }: { n: number }) {
  return n === 0 ? (
    <>{tx(T, "لا معلّق")}</>
  ) : n === 1 ? (
    <>{tx(T, "عملية واحدة معلّقة")}</>
  ) : n === 2 ? (
    <>{tx(T, "عمليتان معلقتان")}</>
  ) : (
    <>
      <N>{n}</N> {tx(T, "عمليات معلّقة")}
    </>
  );
}

function DaysWord({ iso }: { iso: string }) {
  const p = agoParts(iso);
  if (p.unit !== "day") return <>{tx(T, "اليوم")}</>;
  return p.n === 1 ? (
    <>{tx(T, "يوم")}</>
  ) : p.n === 2 ? (
    <>{tx(T, "يومين")}</>
  ) : (
    <>
      <N>{p.n}</N> {tx(T, "أيام")}
    </>
  );
}

function Branches({ n }: { n: number }) {
  return n === 1 ? (
    <>{MOBILE_TEXTS.branchesOne}</>
  ) : n === 2 ? (
    <>{MOBILE_TEXTS.branchesTwo}</>
  ) : (
    <>
      <N>{n}</N> {n <= 10 ? MOBILE_TEXTS.branchesFew : MOBILE_TEXTS.branchesMany}
    </>
  );
}

/** الحدّ الذي يمنع «التأكيد» ويشرحه — نصّ ظاهر لا زرّ معطّل صامت. */
export function confirmBlocker(
  choice: Choose | null,
  scopeOnly: string | null,
  ack: string,
): string | undefined {
  return choice === null && scopeOnly === null
    ? tx(T, "اختر كيف يُسحب")
    : choice === "wipe" && !ack.trim()
      ? tx(T, "الإقرار المكتوب إلزامي")
      : undefined;
}

/**
 * ORG-05 — سحب مستخدم أو نطاق أو جهاز (نظير `revoke-client.tsx`): السحب لا يمحو عملاً؛ العدد يُعرض
 * قبل التأكيد لا بعده؛ الخيار الأوسط (ارفع المعلّق أولاً) ليس الافتراضي؛ التعطيل على جهاز مشترك لا
 * يوقف البقية ولا يُمحى معلّقه. لا مسارات منفصلة للجهاز في الويب: «إلغاء الجهاز» خيار داخل الشاشة.
 */
export function Revoke({ userId }: { userId: string }) {
  const router = useRouter();
  const { api } = useSession();
  const load = useCallback(
    async () =>
      fetched<Preview>(
        await api.GET("/api/org/users/{user_id}/revocation", {
          params: { path: { user_id: userId } },
        }),
      ),
    [api, userId],
  );
  const { data: p, denied: denied403, failed, reload } = useReport<Preview>({ load });
  const [deniedRun, setDeniedRun] = useState(false);
  const [choice, setChoice] = useState<Choose | null>(null);
  const [ack, setAck] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scopeOnly, setScopeOnly] = useState<string | null>(null);

  const denied = denied403 !== null || failed || deniedRun;

  const run = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { data, error, response } = await api.POST("/api/org/users/{user_id}/revocation", {
        params: { path: { user_id: userId } },
        body: body as never,
      });
      if (response.status === 403) {
        setDeniedRun(true);
        return;
      }
      if (!response.ok || !data) {
        const e = error as unknown as { detail?: string } | undefined;
        setErr(e?.detail ?? "failed");
        return;
      }
      setDone(data);
    } catch {
      setErr("failed");
    } finally {
      setBusy(false);
    }
  };

  const disabledDevice = p?.devices.find((d) => d.pending > 0) ?? p?.devices[0];
  const shared = p?.devices.find((d) => d.shared_with.length > 0);

  const state: State =
    denied || (p && !p.can.disable_user && !p.can.revoke_branch)
      ? "permission_denied"
      : done
        ? "success"
        : p && p.blockers.includes("open_shift")
          ? "validation_error"
          : p &&
              p.pending_total > 0 &&
              shared &&
              !p.can.wipe_device === false &&
              choice === null &&
              scopeOnly === null &&
              p.can.disable_user &&
              p.devices.some((d) => d.shared_with.length > 0 && d.pending > 0)
            ? "pending_sync"
            : "ready";

  const confirm = async () => {
    if (!p) return;
    if (scopeOnly) {
      await run({ action: "revoke_branch", branch_id: scopeOnly, reason });
      return;
    }
    if (choice === "wipe" && disabledDevice) {
      await run({
        action: "wipe_device",
        device_id: disabledDevice.id,
        acknowledgement: ack,
        reason,
      });
      return;
    }
    await run({
      action: "disable",
      mode: choice === "after_upload" ? "after_upload" : "now",
      reason,
    });
  };

  const name = p?.user.display_name ?? "";
  const toUsers = () => router.push("/org/users");

  return (
    <Screen screenId={T} state={state} title={tx(T, "سحب الوصول")} onRefresh={() => void reload()}>
      <AppText variant="section">
        {tx(T, "سحب مستخدم أو نطاق أو جهاز — السحب لا يمحو عملاً")}
      </AppText>
      <Note>{tx(T, "المنع فوريّ والعمل أمانة.")}</Note>
      <View style={{ height: SPACE["3"] }} />

      {state === "permission_denied" ? (
        <StateView state="permission_denied" title={tx(T, "مدير الفرع يسحب في فرعه")}>
          <Lead>
            {tx(T, "يسحب وصول موظف عن فرعه، ولا يسحب المستخدم من المنشأة كلها ولا يمحو جهازاً.")}
          </Lead>
          <Note>
            <Strong>{tx(T, "الحدّ")}</Strong>{" "}
            {tx(
              T,
              "· السحب من المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان عهدةً — للمالك وحده.",
            )}
          </Note>
          {p && p.can.revoke_branch ? (
            <Actions>
              {p.scopes
                .filter((s) => s.in_actor_scope)
                .map((s) => (
                  <Button
                    key={s.branch_id}
                    variant="secondary"
                    label={`${tx(T, "سحب نطاق")} ${s.branch_name}`}
                    loading={busy}
                    onPress={() => void run({ action: "revoke_branch", branch_id: s.branch_id })}
                  />
                ))}
            </Actions>
          ) : null}
        </StateView>
      ) : null}

      {state === "validation_error" && p?.ledger.open_shift ? (
        <StateView state="validation_error" title={tx(T, "إجراء محجوب")}>
          <Lead>
            <Strong>
              {tx(T, "تعطيل حساب «")}
              {name}»
            </Strong>{" "}
            {tx(T, "· قبل التعطيل نعرض ما يتعلّق به ولا يزال مفتوحاً")}
          </Lead>
          <Note>
            <Strong>{tx(T, "يوقف")}</Strong>{" "}
            {tx(T, "· الدخول والبيع فوراً — لا جلسة تبقى مفتوحة على أي جهاز بعد التعطيل")}
          </Note>
          <Note>
            <Strong>{tx(T, "مانع")}</Strong> {tx(T, "· وردية مفتوحة منذ")}{" "}
            <DaysWord iso={p.ledger.open_shift.opened_at} />{" "}
            {tx(T, "باسمه — تُقفل إدارياً بعدّ حاضر قبل التعطيل، وإلا بقي صندوق بلا شهادة")}
          </Note>
          <Note>
            <Strong>{tx(T, "يبقى")}</Strong> · <N>{p.ledger.invoices}</N> {tx(T, "فاتورة و")}
            <N>{p.ledger.shifts}</N> {tx(T, "وردية باسمه")}{" "}
            {tx(T, "— منسوبة إليه للأبد — هي شهادته وشهادة الدفتر معاً")}
          </Note>
          <Note>
            <Strong>{tx(T, "أفعاله في سجل التدقيق")}</Strong>{" "}
            {tx(T, "· بما فيها ما اعتُمد له وما رُفض. لا تنظيف للسجل عند الخروج.")}
          </Note>
          <Note>
            {tx(T, "الحذف غير متاح لأن")} <N>{p.ledger.invoices}</N> {tx(T, "فاتورة و")}
            <N>{p.ledger.shifts}</N> {tx(T, "وردية منسوبة لهذا الاسم.")}{" "}
            {tx(T, "حذفه يترك أفعالاً بلا فاعل، وسجل تدقيق بفاعل مجهول لا يصلح دليلاً.")}
          </Note>
          <Note>
            <Strong>{tx(T, "نقل ملكية المنشأة")}</Strong>{" "}
            {tx(
              T,
              "· أخطر إجراء في النظام: ينقل الدفتر كله ومعه الذمم والأجهزة والاشتراك. لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع.",
            )}
          </Note>
          <Actions>
            <Button
              label={tx(T, "تعطيل الدخول فوراً")}
              disabledReason={tx(T, "وردية مفتوحة باسمه — تُقفل إدارياً بعدّ حاضر أولاً")}
              onPress={() => undefined}
            />
            <Button
              variant="secondary"
              label={tx(T, "حذف الحساب — غير متاح")}
              disabledReason={tx(T, "الحذف يترك أفعالاً بلا فاعل")}
              onPress={() => undefined}
            />
          </Actions>
        </StateView>
      ) : null}

      {state === "pending_sync" && p && shared ? (
        <StateView state="pending_sync" title={tx(T, "معلّق المزامنة")}>
          <Lead>
            <Strong>
              {tx(T, "تعطيل")} {name}
            </Strong>{" "}
            {tx(T, "· يعمل على")} {shared.name}
            {tx(T, "، وهو جهاز مشترك مع")} {shared.shared_with.join(` ${tx(T, "و")}`)}.
          </Lead>
          <Note>
            {tx(T, "لـ")}
            {name} <Pending n={shared.pending} /> {tx(T, "على")} {shared.name}
            {tx(
              T,
              "، محفوظة محلياً ولم تصل الخادم. التعطيل يمنع دخوله الجديد ولا يمحو عمله — يُرفع المعلّق باسمه ويُنسب إليه في سجل التدقيق.",
            )}{" "}
            {shared.shared_with.join(` ${tx(T, "و")}`)}{" "}
            {tx(T, "يواصلون العمل على الجهاز نفسه بلا انقطاع.")}
          </Note>
          <Note>
            <Strong>{tx(T, "تعطيل المستخدم")}</Strong> {tx(T, "· يمنع")} {name}{" "}
            {tx(
              T,
              "من الدخول بحسابه على أي جهاز. عمله السابق ومعلّقه يبقيان منسوبين إليه. — الجهاز يعمل · المستخدمون الآخرون يعملون",
            )}
          </Note>
          <Note>
            <Strong>{tx(T, "سحب نطاق فرع")}</Strong>{" "}
            {tx(
              T,
              "· يبقى الحساب نشطاً لكن يفقد الوصول إلى فرع بعينه — يُستعمل عند نقل موظف. — يعمل في فروعه الأخرى",
            )}
          </Note>
          <Note>
            <Strong>{tx(T, "إلغاء الجهاز")}</Strong>{" "}
            {tx(
              T,
              "· يمحو حالة الجهاز نفسه ويقطعه عن المنشأة — يُستعمل عند ضياع أو سرقة الجهاز. — يوقف كل من يعمل عليه · يحتاج استرداد المعلّق أولاً",
            )}
          </Note>
          <Actions>
            <Button
              label={tx(T, "تعطيل المستخدم فقط")}
              loading={busy}
              onPress={() => setChoice("now")}
            />
            <Button variant="secondary" label={tx(T, "إلغاء")} onPress={toUsers} />
            {p.scopes.map((s) => (
              <Button
                key={s.branch_id}
                variant="quiet"
                label={`${tx(T, "سحب نطاق")} ${s.branch_name}`}
                onPress={() => setScopeOnly(s.branch_id)}
              />
            ))}
            <Button
              variant="quiet"
              label={tx(T, "إلغاء الجهاز")}
              onPress={() => setChoice("wipe")}
            />
          </Actions>
        </StateView>
      ) : null}

      {state === "success" && done ? (
        <StateView state="success" title={tx(T, "سُحب الوصول")}>
          <Lead>
            {tx(T, "ما سُحب بالضبط، ومصير المعلّق:")}{" "}
            {done.action === "disable" ? (
              <>
                {tx(T, "دخول")} {name} {tx(T, "إلى المنشأة — مُنع فوراً على كل الأجهزة")}
              </>
            ) : done.action === "revoke_branch" ? (
              <>
                {tx(T, "نطاق فرع — يبقى")} {name} {tx(T, "في")}{" "}
                {done.remaining_branches?.length
                  ? done.remaining_branches.join(tx(T, "،") + " ")
                  : tx(T, "لا فرع آخر")}
              </>
            ) : (
              <>
                {tx(T, "جهاز")} {disabledDevice?.name ?? ""} {tx(T, "— مُحي وقُطع عن المنشأة")}
              </>
            )}
            {done.pending_total > 0 && done.action !== "wipe_device" ? (
              <>
                {" "}
                · <Pending n={done.pending_total} />{" "}
                {tx(T, "محفوظة على الجهاز قابلة للاسترداد من شاشة «الاسترداد».")}
              </>
            ) : null}
          </Lead>
          <Note>{tx(T, "الموظف يرى على جهازه رسالةً تقول إن وصوله سُحب.")}</Note>
          <Note>
            <Strong>{tx(T, "في سجل التدقيق")}</Strong>{" "}
            {tx(T, "· باسم من سحب ووقته وسببه إن كُتب. السحب فعلٌ يُراجَع لاحقاً كغيره.")}
          </Note>
          <Button label={tx(T, "المستخدمون والدعوات")} onPress={toUsers} />
        </StateView>
      ) : null}

      {state === "ready" && p ? (
        <>
          <Heading>
            {tx(T, "سحب وصول —")} {name}
          </Heading>
          <Note>
            <Strong>{tx(T, "ما الذي يُسحب")}</Strong>
          </Note>
          <Note>
            <Strong>{tx(T, "الدخول إلى المنشأة")}</Strong> {tx(T, "· يُمنع فوراً على كل الأجهزة")}
          </Note>
          {p.devices.map((d) => (
            <Note key={d.id}>
              <Strong>
                {tx(T, "جهاز «")}
                {d.name}»
              </Strong>{" "}
              {tx(T, "· العهدة المسجّلة باسمه")}
              {d.pending > 0 ? ` ${tx(T, "· عليه عمل معلّق")}` : ` ${tx(T, "· لا معلّق")}`}
            </Note>
          ))}
          {p.scopes.map((s) => (
            <Note key={s.branch_id}>
              <Strong>
                {tx(T, "نطاق")} {s.branch_name}
              </Strong>{" "}
              · {s.role_name}
              {p.scopes.length > 1 ? (
                <>
                  {" "}
                  {tx(T, "· كان يعمل في")} <Branches n={p.scopes.length} /> {tx(T, "· يبقى في")}{" "}
                  {p.scopes
                    .filter((x) => x.branch_id !== s.branch_id)
                    .map((x) => x.branch_name)
                    .join(tx(T, "،") + " ")}{" "}
                  {tx(T, "إن سُحب هذا النطاق وحده")}
                </>
              ) : null}
            </Note>
          ))}
          {p.pending_total > 0 ? (
            <View style={{ marginTop: SPACE["3"] }}>
              <StateView state="pending_sync" title={tx(T, "على جهازه عملٌ لم يُرفع")}>
                <Lead>
                  <Pending n={p.pending_total} /> {tx(T, "— السحب يقطع رفعها.")}
                </Lead>
              </StateView>
            </View>
          ) : null}

          <Heading>{tx(T, "كيف يُسحب")}</Heading>
          {(
            [
              ["now", tx(T, "اسحب الآن — ويبقى المعلّق محفوظاً للاسترداد لاحقاً")],
              ["after_upload", tx(T, "ارفع المعلّق أولاً ثم اسحب — دقيقتان تقريباً")],
              ["wipe", tx(T, "اسحب فوراً وامحُ بيانات الجهاز — سرقة أو فقد")],
            ] as [Choose, string][]
          ).map(([v, label]) => (
            <Choice
              key={v}
              on={choice === v && scopeOnly === null}
              disabled={v === "wipe" && !p.can.wipe_device}
              onPress={() => {
                setChoice(v);
                setScopeOnly(null);
              }}
            >
              {label}
            </Choice>
          ))}
          {!p.can.wipe_device ? (
            <Note>
              {tx(
                T,
                "· السحب من المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان عهدةً — للمالك وحده.",
              )}
            </Note>
          ) : null}
          {p.scopes
            .filter((s) => s.in_actor_scope)
            .map((s) => (
              <Choice
                key={s.branch_id}
                on={scopeOnly === s.branch_id}
                onPress={() => {
                  setScopeOnly(s.branch_id);
                  setChoice(null);
                }}
              >
                {tx(T, "سحب نطاق")} {s.branch_name}{" "}
                {tx(T, "فقط — يبقى الحساب نشطاً في فروعه الأخرى")}
              </Choice>
            ))}
          <View style={{ height: SPACE["3"] }} />
          {choice === "wipe" ? (
            <TextField
              label={tx(T, "إقرار مكتوب بفقد المعلّق")}
              hint={tx(
                T,
                "يُسجَّل باسمك في سجل التدقيق — المعلّق على الجهاز يُعدّ مفقوداً إلا ما يُسترد من شاشة «الاسترداد» قبل المحو",
              )}
              value={ack}
              onChangeText={setAck}
              required
            />
          ) : null}
          <TextField label={tx(T, "السبب — اختياري")} value={reason} onChangeText={setReason} />
          {err ? (
            <AppText variant="note" accessibilityLiveRegion="polite">
              {err === "acknowledgement_required"
                ? tx(T, "الإقرار المكتوب إلزامي حين على الجهاز معلّق")
                : err === "owner_not_revocable"
                  ? tx(T, "المالك لا يُسحب إلا بنقل ملكية موثَّق")
                  : tx(T, "تعذّر السحب — لم يتغيّر شيء")}
            </AppText>
          ) : null}
          <View style={{ height: SPACE["2"] }} />
          <Button
            financial
            label={tx(T, "تأكيد السحب")}
            loading={busy}
            disabledReason={confirmBlocker(choice, scopeOnly, ack)}
            onPress={() => void confirm()}
          />
          <Button variant="quiet" label={tx(T, "إلغاء")} onPress={toUsers} />
          <View style={{ height: SPACE["3"] }} />
          <Note>
            <Strong>{tx(T, "مدير الفرع يسحب في فرعه")}</Strong>{" "}
            {tx(T, "· يسحب وصول موظف عن فرعه، ولا يسحب المستخدم من المنشأة كلها ولا يمحو جهازاً.")}{" "}
            <Strong>{tx(T, "الحدّ")}</Strong>{" "}
            {tx(
              T,
              "· السحب من المنشأة ومحو الجهاز فعلان لا رجعة فيهما ويمسّان عهدةً — للمالك وحده.",
            )}
          </Note>
        </>
      ) : null}
    </Screen>
  );
}
