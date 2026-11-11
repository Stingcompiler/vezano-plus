"""مراجعة 2026-11-10 (ع-٥): تعبئة مفتاح الفرع في sync_log لما رُفع عبر HTTP قبل الإصلاح.

`PushView` لم يكن يمرّر فرع الجهاز إلى `push()`، فكُتب كل كيان فرعي (بيع، وردية، حركة مخزون…)
بـ`scope_id` فارغ لا يقرؤه أي سحب. الفرع يؤخذ من جهاز العملية المالكة: كل عميل يكتب فرع جهازه.
`server_seq` لا يتغيّر — لا عميل يسحب بعد، فلا مؤشر تجاوز هذه الصفوف.

سياق المنصة يُضبط للمعاملة لأن الجداول تحت RLS مفروضة حتى على مالكها، وقفل `sync_syncstate`
يُؤخذ لأن حارس sync_log يرفض الكتابة خارج قفل المستأجر (الهجرة 0003)."""

from django.db import migrations

BACKFILL_SQL = """
SELECT set_config('sting.platform', 'on', true);
LOCK TABLE sync_syncstate IN ROW EXCLUSIVE MODE;
UPDATE sync_log AS l
SET scope_id = d.branch_id::text
FROM sync_member AS m
JOIN sync_operation AS o ON o.id = m.operation_id AND o.tenant_id = m.tenant_id
JOIN core_device AS d ON d.id = o.device AND d.tenant_id = o.tenant_id
WHERE l.scope = 'branch'
  AND l.scope_id = ''
  AND m.tenant_id = l.tenant_id
  AND m.entity = l.entity
  AND m.entity_id = l.entity_id;
SELECT set_config('sting.platform', '', true);
"""


class Migration(migrations.Migration):
    dependencies = [
        ("sync", "0008_quarantine_recovered"),
        ("core", "0043_tenant_last_country"),
    ]

    operations = [
        migrations.RunSQL(BACKFILL_SQL, reverse_sql=migrations.RunSQL.noop),
    ]
