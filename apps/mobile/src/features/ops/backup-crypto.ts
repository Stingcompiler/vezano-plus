import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  b64,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupContent,
  type BackupEnvelope,
  backupCounts,
  type OpenOutcome,
  openBackup as openWithSubtle,
  PBKDF2_ITERATIONS,
  sealBackup as sealWithSubtle,
  type SealInput,
} from "@sting/sync-core";

import { aesGcmDecrypt, aesGcmEncrypt } from "./aes-gcm";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** هل يوجد `crypto.subtle`؟ (Hermes: لا) */
export const hasSubtle = (): boolean =>
  typeof (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle === "object";

const derive = (password: string, salt: Uint8Array, iterations: number) =>
  pbkdf2Async(sha256, enc.encode(password), salt, { c: iterations, dkLen: 32, asyncTick: 20 });

/**
 * نسخة محلية مشفّرة بصيغة الويب نفسها (PBKDF2-SHA256 ثم AES-GCM 256): حيث يوجد `crypto.subtle` يُستعمل
 * كود sync-core كما هو، وعلى الجوال (Hermes بلا subtle) يُشتق المفتاح بـ@noble ويُشفَّر بـ`aes-gcm.ts`
 * — الملفان متطابقان فيُستعاد ما يُصدَّر هنا على الويب والعكس.
 */
export async function sealBackup(input: SealInput) {
  if (hasSubtle()) return sealWithSubtle(input);
  if (input.password.length < 6) throw new Error("password_short");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const key = await derive(input.password, salt, iterations);
  const cipher = aesGcmEncrypt(key, iv, enc.encode(JSON.stringify(input.content)));
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tenant_id: input.tenantId,
    device_id: input.deviceId,
    exported_at: input.exportedAt,
    sync_epoch: input.syncEpoch,
    counts: backupCounts(input.content),
    kdf: { name: "PBKDF2-SHA256", iterations, salt: b64.encode(salt) },
    iv: b64.encode(iv),
    ciphertext: b64.encode(cipher),
  };
  return envelope;
}

export async function openBackup(envelope: BackupEnvelope, password: string): Promise<OpenOutcome> {
  if (hasSubtle()) return openWithSubtle(envelope, password);
  try {
    const key = await derive(password, b64.decode(envelope.kdf.salt), envelope.kdf.iterations);
    const plain = aesGcmDecrypt(key, b64.decode(envelope.iv), b64.decode(envelope.ciphertext));
    const content = JSON.parse(dec.decode(plain)) as BackupContent;
    if (!Array.isArray(content.operations) || !Array.isArray(content.projections))
      return { ok: false, reason: "corrupt" };
    return { ok: true, content };
  } catch {
    return { ok: false, reason: "wrong_password" };
  }
}
