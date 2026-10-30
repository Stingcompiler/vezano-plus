import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { loadBindings, modKey } from "../screens/desk-shortcuts";
import { type ActionId, comboOf } from "./shortcuts";
import { inTauri } from "./tauri";

/**
 * تنفيذ خريطة الاختصارات (DESK-03) داخل الشاشات المستوردة من الويب — بلا تعديل عليها: الفعل يضغط الزر
 * نفسه أو يركّز الحقل نفسه، فيمرّ بقواعد الشاشة كاملة (الزر المعطَّل بسببه لا يُنفَّذ، والخصم يفتح
 * حواره بسببه الإلزامي، والدفع يفتح شاشة الإتمام ولا ينهي البيع). لا فعل للمرتجع والإلغاء إطلاقاً.
 * في المتصفح يُفعَّل بطلب المواصفة (`__stingDesk.shortcuts`) كي لا تتغيّر مواصفات الويب.
 */
const active = () =>
  inTauri ||
  Boolean((window as unknown as { __stingDesk?: { shortcuts?: boolean } }).__stingDesk?.shortcuts);

function enabledButton(selector: string): HTMLButtonElement | null {
  const b = document.querySelector<HTMLButtonElement>(selector);
  return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
}

type Run = (path: string, navigate: (to: string) => void) => boolean;

const RUN: Partial<Record<ActionId, Run>> = {
  search(path, navigate) {
    const field =
      path === "/pos" ? document.querySelector<HTMLInputElement>(".pos-search input") : null;
    if (field) field.focus();
    else navigate("/search");
    return true;
  },
  qty(path) {
    if (path !== "/pos") return false;
    const lines = document.querySelectorAll<HTMLButtonElement>(".c-cart__line-main");
    const last = lines[lines.length - 1];
    last?.click();
    return Boolean(last);
  },
  checkout(path) {
    if (path !== "/pos") return false;
    const pay = enabledButton(".pos-cart__actions button");
    pay?.click();
    return Boolean(pay);
  },
  discount(path, navigate) {
    if (path !== "/pos" || !document.querySelector(".c-cart__line")) return false;
    navigate("/pos/discount");
    return true;
  },
};

export function ShortcutRunner() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!active()) return;
    const mod = modKey();
    let bindings: Partial<Record<ActionId, string>> = {};
    void loadBindings(mod).then((b) => (bindings = b));
    const onKey = (e: KeyboardEvent) => {
      // خريطة الاختصارات نفسها تلتقط الضغطة لتعديلها
      if (pathname === "/desktop/shortcuts") return;
      const combo = comboOf(e, mod);
      const id = (Object.keys(bindings) as ActionId[]).find((k) => bindings[k] === combo);
      if (!id) return;
      const typing = e.target instanceof HTMLElement && e.target.matches("input, textarea, select");
      // الكتابة في حقل لا تُختطف بمفتاح عادي — الوظيفية والتركيبات وحدها
      if (typing && !/^F\d+$/.test(e.key) && !(e.ctrlKey || e.metaKey)) return;
      if (RUN[id]?.(pathname, (to) => void navigate(to))) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);
  return null;
}
