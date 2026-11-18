from django.db import migrations

# مراجعة 2026-11-18 (0005 §٢٧٩): 0045 ملأ نهاية التجربة للمتاجر التي ما زالت على «trial» وحدها، فخرجت
# المتاجر التي جرّبت ثم اشتركت من قياس «الدفع بعد التجربة». نهايتها الأقرب المسجّلة بداية أول فترة
# تجديد مدفوعة (`period_from` = نهاية التجربة إن دُفع قبلها، أو وقت الاعتماد إن دُفع بعدها).
SQL = """SELECT set_config('sting.platform', 'on', true);
UPDATE core_tenantsubscription s SET trial_ends_at = r.first_from
FROM (
    SELECT rc.tenant_id, MIN(rc.period_from) AS first_from
    FROM core_subscriptionreceipt rc
    JOIN core_subscriptionproof p ON p.id = rc.proof_id
    WHERE p.kind = 'renewal' AND rc.amount_minor > 0
    GROUP BY rc.tenant_id
) r
WHERE s.tenant_id = r.tenant_id AND s.trial_ends_at IS NULL AND s.plan_code <> 'trial'
  AND r.first_from >= s.started_at;"""


class Migration(migrations.Migration):
    dependencies = [("core", "0045_trial_followup")]
    operations = [migrations.RunSQL(SQL, reverse_sql=migrations.RunSQL.noop)]
