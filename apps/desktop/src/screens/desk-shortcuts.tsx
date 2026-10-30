import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useEffect, useState } from "react";

import { AppNav } from "@/features/home/app-nav";
import { getStorage } from "@/lib/storage";

import {
  ACTIONS,
  type ActionId,
  type Bindings,
  type Check,
  checkBinding,
  comboOf,
  defaultBindings,
  type ShortcutAction,
} from "../platform/shortcuts";
import { detectOs } from "../platform/tauri";
import "./desk.css";

/** DESK-03 اختصارات وإدارة التركيز (37-D29 ready/validation_error · 09-D5 conflict). */
const KEY = "desktop.shortcuts";
export const modKey = () => (detectOs(navigator.userAgent) === "mac" ? "⌘" : "Ctrl");

export async function loadBindings(mod: string): Promise<Bindings> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(KEY));
    return raw
      ? { ...defaultBindings(mod), ...(JSON.parse(raw) as Bindings) }
      : defaultBindings(mod);
  } catch {
    return defaultBindings(mod);
  }
}

export function DeskShortcuts() {
  const mod = modKey();
  const [bindings, setBindings] = useState<Bindings>(defaultBindings(mod));
  const [editing, setEditing] = useState<ActionId | null>(null);
  const [check, setCheck] = useState<{ combo: string; result: Check } | null>(null);

  useEffect(() => {
    void loadBindings(mod).then(setBindings);
  }, [mod]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setEditing(null);
        return;
      }
      const combo = comboOf(e, mod);
      if (["Shift", "Alt", "Meta", "Control"].includes(e.key)) return;
      const result = checkBinding(editing, combo, bindings, mod);
      setCheck({ combo, result });
      if (result.ok) {
        const next = { ...bindings, [editing]: combo };
        setBindings(next);
        void getStorage().transaction((tx) => tx.putMeta(KEY, JSON.stringify(next)));
        setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, bindings, mod]);

  const state =
    check && !check.result.ok
      ? check.result.kind === "system"
        ? "conflict"
        : "validation_error"
      : "ready";

  return (
    <Frame title="اختصارات لوحة المفاتيح" nav={<AppNav currentId="desk-shortcuts" />} footer={null}>
      <div className="desk" data-screen="DESK-03" data-state={state}>
        <div className="c-card desk__head">
          <div>
            <h2 className="desk__title">خريطة الاختصارات</h2>
            <p className="desk__sub">
              مجموعةٌ بالسياق: البيع، البحث، الدفع، الإقفال. قابلة للتعديل ومطبوعة في ورقة واحدة
              يُعلَّق بها.
            </p>
          </div>
        </div>
        <Table<ShortcutAction>
          caption="اختصارات لوحة المفاتيح"
          rows={ACTIONS}
          rowKey={(a) => a.id}
          columns={[
            {
              key: "key",
              header: "الاختصار",
              render: (a) => <kbd className="sting-mono desk__kbd">{bindings[a.id] ?? "—"}</kbd>,
            },
            { key: "act", header: "الإجراء", render: (a) => <strong>{a.act}</strong> },
            {
              key: "confirm",
              header: "التأكيد",
              render: (a) => <Status state={a.state} label={a.confirm} dot={false} />,
            },
            {
              key: "note",
              header: "ملاحظة",
              render: (a) =>
                a.editable ? (
                  <span>
                    {a.note}{" "}
                    <Button
                      variant="quiet"
                      aria-pressed={editing === a.id}
                      onClick={() => setEditing(a.id)}
                    >
                      استبدله
                    </Button>
                  </span>
                ) : (
                  a.note
                ),
            },
          ]}
        />
        {check && !check.result.ok && check.result.kind === "taken" ? (
          <Notice kind="error" title="اختصار مستخدم">
            الاختصار المطلوب محجوز لفعلٍ آخر أو للنظام نفسه.{" "}
            <span className="sting-mono">{check.combo}</span> محجوز لـ: {check.result.owner}
          </Notice>
        ) : null}
        {check && !check.result.ok && check.result.kind === "system" ? (
          <Notice kind="warning" title="تعارض اختصار">
            <span className="sting-mono">{check.combo}</span> يخصه نظامك، وحجزناه له. المفتاح سيعمل
            أحياناً وأحياناً لا، والإجراء المالي لا يحتمل «أحياناً». اختر تركيبة أخرى من قائمة
            المتاح.
          </Notice>
        ) : null}
        <div className="desk__grid">
          <div className="c-card desk__pad">
            <strong>التركيز يتبع العمل</strong>
            <p className="desk__sub">
              بعد مسح صنف يعود المؤشّر إلى حقل البحث. كل خطوة تُعيد التركيز إلى ما بعدها.
            </p>
          </div>
          <div className="c-card desk__pad">
            <strong>إدارة التركيز.</strong>
            <p className="desk__sub">
              عند فتح حوار مالي يُحصر التركيز داخله، ويبقى زر التنفيذ غير مُفعَّل حتى تلمس حقلاً
              مطلوباً — فلا يُنفَّذ خصم بضغطة Enter تائهة من شاشة سابقة.
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}
