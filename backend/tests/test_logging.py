"""مراجعة 2026-11-10 (ع-١٤): للخادم إعداد سجلات — أخطاء الطلبات تخرج بأثرها ووقتها ومستواها."""

from __future__ import annotations

import io
import logging
import logging.config
from typing import Any

from django.conf import settings


def test_logging_writes_timestamped_lines_with_traceback() -> None:
    base: dict[str, Any] = settings.LOGGING
    assert base["root"]["handlers"] == ["stderr"]
    out = io.StringIO()
    config = {
        **base,
        "handlers": {"stderr": {**base["handlers"]["stderr"], "stream": out}},
    }
    logging.config.dictConfig(config)
    try:
        try:
            raise RuntimeError("خلل في المُطبِّق")
        except RuntimeError:
            logging.getLogger("sync.push").exception("push: operation %s failed", "op-1")
        logging.getLogger("django.request").warning("Not Found: /x")
    finally:
        logging.config.dictConfig(settings.LOGGING)
    text = out.getvalue()
    first = text.splitlines()[0]
    assert " ERROR sync.push: push: operation op-1 failed" in first and first[:4].isdigit()
    assert "RuntimeError: خلل في المُطبِّق" in text
    # 4xx المتوقعة لا تملأ السجل
    assert "Not Found" not in text
