"""الموزّع الفوري (0005 §٢١٦): `push_dispatch` دورة واحدة، و`--loop` حلقة دائمة في حاوية العامل.

يرسل ما وصل كل `--interval` ثانية (افتراضاً 15)، ويشتقّ التشغيلي لكل منشأة كل `--derive-every`
ثانية (افتراضاً 300) — الاشتقاق أثقل من الإرسال."""

from __future__ import annotations

import time
from typing import Any

from django.core.management.base import BaseCommand, CommandParser
from django.db import close_old_connections

from core import push, push_dispatch


class Command(BaseCommand):
    help = "يرسل الإشعارات الفورية (Web Push) لما لم يُرسل بعد."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--loop", action="store_true")
        parser.add_argument("--interval", type=int, default=15)
        parser.add_argument("--derive-every", type=int, default=300)

    def handle(self, *args: Any, **opts: Any) -> None:
        if not opts["loop"]:
            self.stdout.write(str(push_dispatch.dispatch_all(derive=True)))
            return
        if not push.push_configured():
            self.stdout.write("push: مفاتيح VAPID غير مضبوطة — الموزّع ينتظر ولا يرسل")
        last_derive = 0.0
        while True:
            close_old_connections()
            now = time.monotonic()
            derive = now - last_derive >= opts["derive_every"]
            if derive:
                last_derive = now
            if push.push_configured():
                push_dispatch.dispatch_all(derive=derive)
            time.sleep(max(1, opts["interval"]))
