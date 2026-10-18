"""0005 §١٧٠ — التجريبية على باقة أساس تحدّدها إدارة المنصّة (البذر: «فرع واحد» كما كان الوصف يعد)."""

from django.db import migrations, models


def forwards(apps, schema_editor):  # type: ignore[no-untyped-def]
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    base = (
        PlanCatalog.objects.filter(trial=False, is_active=True, code="single").first()
        or PlanCatalog.objects.filter(trial=False, is_active=True).order_by("order", "code").first()
    )
    if base is not None:
        PlanCatalog.objects.filter(trial=True, trial_base_code="").update(trial_base_code=base.code)


class Migration(migrations.Migration):
    dependencies = [("core", "0039_trial_blurb_matches_policy")]

    operations = [
        migrations.AddField(
            model_name="plancatalog",
            name="trial_base_code",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
