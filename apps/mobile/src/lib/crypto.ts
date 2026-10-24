import * as ExpoCrypto from "expo-crypto";

/**
 * Hermes بلا `crypto.randomUUID`/`getRandomValues`، والحزم المشتركة (sync-core، app-core) تكتبها كما
 * في المتصفح: معرّفات العمليات والطلبات. نسدّها من `expo-crypto` (مولّد النظام الآمن) قبل أي استعمال.
 */
const g = globalThis as { crypto?: Partial<Crypto> };
g.crypto ??= {};
if (typeof g.crypto.randomUUID !== "function") {
  g.crypto.randomUUID = () =>
    ExpoCrypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
}
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = ExpoCrypto.getRandomValues as Crypto["getRandomValues"];
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}
