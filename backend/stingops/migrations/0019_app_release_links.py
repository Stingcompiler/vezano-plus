"""0005 §٢٣٠ — روابط متجر التطبيقات: رابط بتسمية وأيقونة بدل `apple_url` الخاص بآيفون."""

from __future__ import annotations

from typing import Any

from django.db import migrations, models


def apple_to_link(apps: Any, _schema: Any) -> None:
    AppRelease = apps.get_model("stingops", "AppRelease")
    for r in AppRelease.objects.exclude(apple_url=""):
        flight = "testflight." in r.apple_url
        r.link_url = r.apple_url
        r.link_label = "فتح في TestFlight" if flight else "فتح في App Store"
        r.link_icon = "app_store"
        r.save(update_fields=["link_url", "link_label", "link_icon"])


def link_to_apple(apps: Any, _schema: Any) -> None:
    AppRelease = apps.get_model("stingops", "AppRelease")
    for r in AppRelease.objects.filter(platform="ios").exclude(link_url=""):
        r.apple_url = r.link_url
        r.save(update_fields=["apple_url"])


class Migration(migrations.Migration):
    dependencies = [("stingops", "0018_site_visit")]

    operations = [
        migrations.AddField(
            model_name="apprelease",
            name="link_url",
            field=models.URLField(blank=True, default="", max_length=500),
        ),
        migrations.AddField(
            model_name="apprelease",
            name="link_label",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="apprelease",
            name="link_icon",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.RunPython(apple_to_link, link_to_apple),
        migrations.RemoveField(model_name="apprelease", name="apple_url"),
    ]
