"""فحص 2026-10-17 F11: وصف الباقة التجريبية كان يقول «تتحوّل للقراءة والبيع النقدي» عند الانتهاء،
والسياسة المعتمدة (`CONTINUES`، 0005 §١٦٠) أن البيع كاملاً نقدياً وآجلاً ومختلطاً يستمر. يُحدَّث الوصف
إن بقي على نصّه القديم (لا يُكتب فوق تعديل المشغّل)."""

from django.db import migrations

OLD = "كل ميزات باقة الفرع الواحد. عند الانتهاء تبقى بياناتك وتتحوّل للقراءة والبيع النقدي."
NEW = "كل ميزات باقة الفرع الواحد. عند الانتهاء يستمر البيع كاملاً وتبقى بياناتك لك."


def forward(apps, schema_editor):  # type: ignore[no-untyped-def]
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    PlanCatalog.objects.filter(code="trial", blurb=OLD).update(blurb=NEW)


def backward(apps, schema_editor):  # type: ignore[no-untyped-def]
    PlanCatalog = apps.get_model("core", "PlanCatalog")
    PlanCatalog.objects.filter(code="trial", blurb=NEW).update(blurb=OLD)


class Migration(migrations.Migration):
    dependencies = [("core", "0038_device_refresh_token")]
    operations = [migrations.RunPython(forward, backward)]
