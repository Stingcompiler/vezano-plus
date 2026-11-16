from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0044_notification_for_user")]
    operations = [
        migrations.AddField(
            model_name="tenantsubscription",
            name=name,
            field=models.DateTimeField(blank=True, null=True),
        )
        for name in ("trial_ends_at", "first_trial_report_at")
    ] + [
        migrations.RunSQL(
            """SELECT set_config('sting.platform', 'on', true);
            UPDATE core_tenantsubscription SET trial_ends_at = expires_at
            WHERE plan_code = 'trial' AND state IN ('trial', 'expired');""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
