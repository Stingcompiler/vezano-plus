"""يحذف زيارات أقدم من `ANALYTICS_RETENTION_DAYS` (0005 §٢١٩) — من الجدولة الليلية."""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand

from stingops import analytics


class Command(BaseCommand):
    help = "Delete site visits older than the retention window"

    def handle(self, *args: Any, **options: Any) -> None:
        self.stdout.write(f"analytics_prune deleted={analytics.prune()}")
