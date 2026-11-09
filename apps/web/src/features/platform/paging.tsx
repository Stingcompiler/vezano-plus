"use client";

import { Pagination } from "@sting/ui-web";

/** ترقيم قوائم المشغّل (0005 §٢٢٨): الخادم يقصّ الصفحة ويعيد وصفها؛ الشاشة تطلب `page` و`page_size`. */
export const PAGE_SIZE = 25;

export interface PageInfo {
  readonly number: number;
  readonly size: number;
  readonly total: number;
  readonly pages: number;
}

/** معاملا الصفحة لاستعلام القائمة. */
export const pageQuery = (page: number) => ({ page, page_size: PAGE_SIZE });

/** شريط الترقيم تحت القائمة؛ تغيير الصفحة يعيد القارئ إلى أعلى القائمة. */
export function PlatformPager({
  info,
  onPage,
  anchorId,
}: {
  info: PageInfo | undefined;
  onPage: (page: number) => void;
  anchorId?: string;
}) {
  if (!info || info.pages <= 1) return null;
  return (
    <Pagination
      page={info.number}
      pageCount={info.pages}
      total={info.total}
      pageSize={info.size}
      onPage={(p) => {
        onPage(p);
        if (anchorId) document.getElementById(anchorId)?.scrollIntoView({ block: "start" });
      }}
    />
  );
}
