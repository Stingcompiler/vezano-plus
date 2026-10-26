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
 * PTY-03 (إنشاء) — عميل جديد من دفتر العملاء: نموذج الإنشاء نفسه في POS-04 بلا سياق البيع. الاسم
 * وحده إلزامي والهاتف اختياري؛ التشابه (الاسم أو الهاتف) يُعرض ويُسأل عنه ولا يُمنع ولا يُدمج.
 * الإنشاء محلي ثم يُرفع، وإنشاء الطرف لا يُنشئ رصيداً.
 */
export default function NewParty() {
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
    <Screen screenId={T} state={state} title={tx("PTY-01", "عميل جديد")}>
      <TextField
        label={tx(T, "الاسم")}
        value={name}
        onChangeText={setName}
        error={attempted && !name.trim() ? tx(T, "الاسم إلزامي") : undefined}
        required
      />
      <TextField
        label={tx(T, "الهاتف")}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        mono
        hint={tx(T, "اختياري")}
      />
      {dup ? (
        <StateView
          state="validation_error"
          title={
            similar.byName
              ? tx("POS-04", "يوجد عميل بنفس الاسم")
              : tx("POS-04", "هاتف مسجَّل على طرف قائم")
          }
        >
          <AppText variant="secondary">{dup.name}</AppText>
          <Button label={tx("POS-04", "استخدام العميل الموجود")} onPress={() => open(dup.id)} />
          <Button
            label={tx("POS-04", "إنشاء منفصل مع تمييز")}
            variant="secondary"
            onPress={() => void create(dup.id)}
          />
        </StateView>
      ) : null}
      <AppText variant="note" muted style={{ marginBottom: 12 }}>
        {tx(T, "· إنشاء الطرف لا يُنشئ رصيداً. الرصيد الافتتاحي مستندٌ له شاشته وصلاحيته.")}
      </AppText>
      <Button
        label={tx("POS-04", "إنشاء عميل جديد")}
        financial
        loading={busy}
        onPress={() => void create()}
      />
    </Screen>
  );
}
