# 0005 §٢٧٥: إشعار لمستخدم بعينه (ردّ الفريق على ملاحظته)

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0043_tenant_last_country"),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="for_user",
            field=models.UUIDField(blank=True, null=True),
        ),
    ]
