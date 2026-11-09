import type { Metadata } from "next";

import { DirectoryClient } from "@/features/platform/directory-client";

export const metadata: Metadata = { title: "جدول المستأجرين · الإدارة" };

/** PLT-20 — جدول المستأجرين بالدولة والأجهزة (0005 §٢٢٩). */
export default function PlatformDirectoryPage() {
  return <DirectoryClient />;
}
