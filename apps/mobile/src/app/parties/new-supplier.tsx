import { pushPending } from "@sting/app-core";
import {
  createPartyLocally,
  findSimilarLocal,
  type LocalParty,
  readLocalParties,
} from "@sting/sync-core";
import { tx } from "@sting/texts";
import { AppText, Button, Screen, StateView, TextField } from "@sting/ui-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { newId } from "@/lib/crypto";
import { useSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";

const T = "PTY-03";

/**
 * PTY-03 (إنشاء بصفة مورد) — «مورد جديد» (مراجعة الأطراف 2026-11-20، المرحلة ٢؛ 0005 §٢٨٣): كان
 * المورد لا يُنشأ إلا عميلاً ثم تعديل بطاقته. كالإنشاء السريع للعميل: الاسم وحده إلزامي، محلي ثم
 * يُرفع، والتشابه يُعرض ولا يُمنع ولا يُدمج. صفة «عميل» وحدّ الائتمان من «تعديل البطاقة» بعده.
 */
export default function NewSupplier() {
  const router = useRouter();
  const { api } = useSession();
  const [parties, setParties] = useState<LocalParty[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<{ byName: LocalParty | null; byPhone: LocalParty | null }>(
    { byName: null, byPhone: null },
  );
  const ids = useRef({ operationId: "", partyId: "" });

  useEffect(() => {
    void getStorage().then(readLocalParties).then(setParties);
  }, []);

  const open = (id: string) => router.replace({ pathname: "/parties/[id]", params: { id } });

  const create = async (distinctFromId?: string) => {
    setAttempted(true);
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
      if (!ids.current.operationId) ids.current = { operationId: newId(), partyId: newId() };
      const storage = await getStorage();
      const { party } = await createPartyLocally(storage, {
        ...ids.current,
        name,
        phone,
        distinctFromPartyId: distinctFromId,
        role: "supplier",
        occurredAt: new Date().toISOString(),
      });
      void pushPending({ api, storage, requestId: newId }).catch(() => undefined);
      open(party.id);
    } finally {
      setBusy(false);
    }
  };

  const dup = similar.byName ?? similar.byPhone;
  const state = dup ? "validation_error" : attempted && !name.trim() ? "validation_error" : "ready";

  return (
    <Screen screenId={T} state={state} title={tx(T, "مورد جديد")}>
      <TextField
        label={tx(T, "الاسم")}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setSimilar({ byName: null, byPhone: null });
        }}
        error={attempted && !name.trim() ? tx(T, "الاسم إلزامي") : undefined}
        required
      />
      <TextField
        label={tx(T, "الهاتف")}
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          setSimilar({ byName: null, byPhone: null });
        }}
        keyboardType="phone-pad"
        mono
        hint={tx(T, "اختياري")}
      />
      {dup ? (
        <StateView
          state="validation_error"
          title={
            similar.byName ? tx(T, "يوجد طرف بنفس الاسم") : tx("POS-04", "هاتف مسجَّل على طرف قائم")
          }
        >
          <AppText variant="secondary">
            {similar.byName
              ? `«${dup.name}${tx(T, "» مسجَّل في دفترك. إن كان هو، افتح بطاقته وفعّل «مورد» من «تعديل البطاقة».")}`
              : dup.name}
          </AppText>
          <Button label={tx(T, "بطاقة الطرف")} onPress={() => open(dup.id)} />
          <Button
            label={tx("POS-04", "إنشاء منفصل مع تمييز")}
            variant="secondary"
            onPress={() => void create(dup.id)}
          />
        </StateView>
      ) : null}
      <AppText variant="note" muted style={{ marginBottom: 12 }}>
        {tx(T, "الاسم فقط إلزامي. صفة «عميل» وحدّ الائتمان من «تعديل البطاقة» بعد الإنشاء.")}
      </AppText>
      <Button label={tx(T, "مورد جديد")} financial loading={busy} onPress={() => void create()} />
    </Screen>
  );
}
