"""مصدر التكلفة من سطور الاستلام بعد د-١ (0005 §٢٨٩).

الاستلام وحده يُدخل المخزون، ومستند الشراء المربوط به يضيف السعر. حين يُعتمد مستند مربوط باستلام
قائم يُكتب سطر تكلفة باسم المستند (`PD-n`) بلا حركة مخزون، فيصير لنفس البضاعة سطران: سطر أمين
المخزن (بتكلفة اختيارية) وسطر الفاتورة. قارئ التكلفة يأخذ سطر الفاتورة ويترك سطر الاستلام لنفس
الصنف — فلا تُحسب الكمية مرتين في المتوسط، ولا يغلب تقديرُ المستلِم سعرَ الفاتورة. سطر الاستلام
نفسه لا يُعدَّل.
"""

from __future__ import annotations

from django.db.models import Exists, OuterRef, QuerySet

from inventory.models import GoodsReceiptLine, PurchaseDocument, PurchaseDocumentLine


def costed_receipt_lines() -> QuerySet[GoodsReceiptLine]:
    """كل سطور الاستلام عدا ما سعّره مستند شراء معتمد مربوط بالاستلام نفسه للصنف نفسه."""
    billed = PurchaseDocumentLine.objects.filter(
        document__status=PurchaseDocument.Status.APPROVED,
        document__receipt_links__kind="linked",
        document__receipt_links__receipt_id=OuterRef("receipt_id"),
        item_id=OuterRef("item_id"),
    )
    return GoodsReceiptLine.objects.filter(~Exists(billed))
