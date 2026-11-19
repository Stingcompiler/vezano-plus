from django.db import migrations

# مراجعة 2026-11-19 (0005 §٢٨١): ‏core/0046 ملأ «نهاية التجربة» من أول إيصال تجديد لكل متجر مدفوع بلا
# نهاية مسجّلة — ومنها متاجر لم تجرّب قط: منشأة بانتظار الاعتماد اعتُمد لها إثبات دفع أو غُيّرت باقتها
# قبل اعتماد تجربتها. تلك لا حدث «اعتماد التجربة» لها، وأُنشئت بعد بدء الاعتماد (§١٨٨، 2026-10-20)؛
# ما قبله بُذر تجريبياً فعلاً فيبقى. هنا تُعاد نهايتها فارغة فتخرج من «الدفع بعد التجربة».
SQL = """SELECT set_config('sting.platform', 'on', true);
UPDATE core_tenantsubscription s SET trial_ends_at = NULL
FROM core_tenant t
WHERE t.id = s.tenant_id AND s.trial_ends_at IS NOT NULL AND s.plan_code <> 'trial'
  AND t.created_at >= '2026-10-20T00:00:00Z'
  AND NOT EXISTS (
    SELECT 1 FROM stingops_subscriptionevent e
    WHERE e.tenant_id = s.tenant_id AND e.kind = 'trial_approved'
  );"""


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0046_trial_end_for_converted"),
        ("stingops", "0025_app_download_per_link"),
    ]
    operations = [migrations.RunSQL(SQL, reverse_sql=migrations.RunSQL.noop)]
