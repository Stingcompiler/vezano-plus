"""ما يسجّله السوق في سجلّات الوحدات الأخرى — بلا استيراد عكسي منها إليه."""

from __future__ import annotations

import uuid

from market.models import MarketPartyLink
from parties import services as _party_services


def linked_party_ids(ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """M-11: الأطراف المربوطة بمنشأة سوق بربط مقبول — يُقرأ في سياق المستأجر (طرفي أنا)."""
    if not ids:
        return set()
    return set(
        MarketPartyLink.objects.filter(
            party_id__in=ids, status=MarketPartyLink.Status.ACCEPTED
        ).values_list("party_id", flat=True)
    )


_party_services.MARKET_LINKED_PROVIDERS.append(linked_party_ids)
