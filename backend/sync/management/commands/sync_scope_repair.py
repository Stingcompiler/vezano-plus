"""`manage.py sync_scope_repair [--tenant ID] [--apply]` — سجلات sync_log الفرعية بلا فرع.

بلا `--apply` تقرير فقط: العدد لكل كيان والفرع المستنتج ومصدره (جهاز الرفع أو المستند)، وما لا يُعرف
فرعه. مع `--apply` يُكتب المستنتج برقم جديد فيصل إلى سحب أجهزة الفرع؛ المجهول لا يُخمَّن. راجع
`sync/scope_repair.py`.
"""

from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from django.core.management.base import BaseCommand

from core.models import Tenant
from core.tenancy import platform_context
from sync.scope_repair import apply_fixes, find_unscoped


class Command(BaseCommand):
    help = "يقرّر (ثم يصلح بـ--apply) نطاق سجلات sync_log الفرعية المكتوبة بلا فرع."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--tenant", help="معرّف منشأة واحدة (افتراضاً كل المنشآت)")
        parser.add_argument("--apply", action="store_true", help="اكتب الفرع المستنتج")

    def handle(self, *args: Any, **opts: Any) -> None:
        with platform_context():
            qs = Tenant.unscoped.all()
            if opts.get("tenant"):
                qs = qs.filter(id=uuid.UUID(opts["tenant"]))
            tenants = list(qs.values_list("id", "name"))
        total = unknown = fixed = 0
        for tid, name in tenants:
            fixes = find_unscoped(tid)
            if not fixes:
                continue
            total += len(fixes)
            missing = [f for f in fixes if not f.branch_id]
            unknown += len(missing)
            self.stdout.write(f"{name} ({tid}): {len(fixes)} صفاً بلا فرع")
            for (entity, source), n in sorted(Counter((f.entity, f.source) for f in fixes).items()):
                self.stdout.write(f"  {entity} — {source}: {n}")
            if opts["apply"]:
                done = apply_fixes(tid, fixes)
                fixed += done
                self.stdout.write(self.style.SUCCESS(f"  صُحّح {done}"))
        mode = "تطبيق" if opts["apply"] else "تقرير فقط (أضف --apply للكتابة)"
        self.stdout.write(f"المجموع {total}، مجهول الفرع {unknown}، مصحَّح {fixed} — {mode}")
