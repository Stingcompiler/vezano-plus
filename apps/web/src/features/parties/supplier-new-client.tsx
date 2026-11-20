"use client";

import {
  createPartyLocally,
  findSimilarLocal,
  type LocalParty,
  readLocalParties,
} from "@sting/sync-core";
import { Button, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/parties/parties.css";
import { AppNav } from "@/features/home/app-nav";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

type State = "ready" | "validation_error" | "saving";

/**
 * «مورد جديد» (PTY-03 إنشاءً؛ مراجعة الأطراف 2026-11-20، المرحلة ٢ — 0005 §٢٨٣): كان المورد لا يُنشأ
 * إلا عميلاً ثم تعديل بطاقته. الإنشاء هنا كالإنشاء السريع للعميل (§٧.٥): الاسم فقط إلزامي، والهاتف
 * اختياري، ومحلياً بلا اتصال، والتشابه المضلل يُعرض ولا يُمنع ولا يُدمج تلقائياً. الصفة الثانية
 * (عميل) وحدّ الائتمان من «تعديل البطاقة» بعده.
 */
export function SupplierNewClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [parties, setParties] = useState<LocalParty[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [similar, setSimilar] = useState<{ byName: LocalParty | null; byPhone: LocalParty | null }>(
    { byName: null, byPhone: null },
  );
  const [busy, setBusy] = useState(false);
  const opIds = useRef({ operationId: "", partyId: "" });
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fparties%2Fnew-supplier");
      return;
    }
    void (async () => setParties(await readLocalParties(getStorage())))();
  }, [router]);

  const clearSimilar = () => setSimilar({ byName: null, byPhone: null });
  const card = (p: LocalParty) => router.push(`/parties/${p.id}`);

  const create = async (distinctFromId?: string) => {
    if (!name.trim() || busy) return;
    if (!distinctFromId) {
      const sim = findSimilarLocal(parties, name, phone);
      if (sim.byName[0] || sim.byPhone[0]) {
        setSimilar({ byName: sim.byName[0] ?? null, byPhone: sim.byPhone[0] ?? null });
        return;
      }
    }
    setBusy(true);
    try {
      if (!opIds.current.operationId)
        opIds.current = { operationId: crypto.randomUUID(), partyId: crypto.randomUUID() };
      const { party } = await createPartyLocally(getStorage(), {
        ...opIds.current,
        name,
        phone,
        distinctFromPartyId: distinctFromId,
        role: "supplier",
        occurredAt: new Date().toISOString(),
      });
      if (online) void pushPending();
      card(party);
    } finally {
      setBusy(false);
    }
  };

  const state: State = busy
    ? "saving"
    : similar.byName || similar.byPhone
      ? "validation_error"
      : "ready";

  return (
    <Frame title="الموردون" nav={<AppNav currentId="suppliers" />} footer={null}>
      <div className="pos pos--wide" data-screen="PTY-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مورد جديد</h2>
          </div>
          <div className="acc-card__body">
            {!online ? (
              <p className="acc-choice__note">
                بلا اتصال: الإنشاء محلي ويُرفع عند الاتصال، وفحص «الرقم مسجَّل على طرف آخر» يكتمل
                عند المزامنة.
              </p>
            ) : null}
            <TextField
              label="الاسم"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearSimilar();
              }}
              required
            />
            <TextField
              label="الهاتف"
              mono
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                clearSimilar();
              }}
            />
            {similar.byName ? (
              <Notice kind="error" title="يوجد طرف بنفس الاسم">
                <p className="acc-lead">
                  «{similar.byName.name}» مسجَّل في دفترك. إن كان هو، افتح بطاقته وفعّل «مورد» من
                  «تعديل البطاقة».
                </p>
                <div className="acc-actions">
                  <Button onClick={() => card(similar.byName!)}>بطاقة الطرف</Button>
                  <Button variant="secondary" onClick={() => void create(similar.byName!.id)}>
                    إنشاء منفصل مع تمييز
                  </Button>
                </div>
              </Notice>
            ) : similar.byPhone ? (
              <Notice kind="error" title="هاتف مسجَّل على طرف قائم">
                <p className="acc-lead">الرقم المدخل رقم «{similar.byPhone.name}».</p>
                <div className="acc-actions">
                  <Button onClick={() => card(similar.byPhone!)}>هذا هو</Button>
                  <Button variant="secondary" onClick={() => void create(similar.byPhone!.id)}>
                    طرف جديد بنفس الرقم
                  </Button>
                </div>
              </Notice>
            ) : null}
            <p className="acc-choice__note">
              الاسم فقط إلزامي. صفة «عميل» وحدّ الائتمان من «تعديل البطاقة» بعد الإنشاء.
            </p>
            <div className="cat-form__actions">
              <Button
                financial
                onClick={() => void create()}
                loading={busy}
                disabledReason={name.trim() ? undefined : "الاسم"}
              >
                أنشئ: {name.trim() || "—"}
              </Button>
              <Button variant="secondary" onClick={() => router.push("/parties/suppliers")}>
                الموردون
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
