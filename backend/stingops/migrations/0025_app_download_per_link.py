# مراجعة 2026-11-18 (0005 §٢٧٩): صفّ لكل رابط تنزيل، والتنزيل الفعلي `downloaded_at`

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("stingops", "0024_app_download"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="appdownload",
            name="token_digest",
        ),
        migrations.AddField(
            model_name="appdownload",
            name="issued_at",
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
        migrations.AlterField(
            model_name="appdownload",
            name="downloaded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        # الصفوف السابقة كلها تنزيلات خُدمت فعلاً: وقت إصدار رابطها هو وقت تنزيلها
        migrations.RunSQL(
            "UPDATE stingops_appdownload SET issued_at = downloaded_at;",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
