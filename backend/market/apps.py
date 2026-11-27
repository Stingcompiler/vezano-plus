from django.apps import AppConfig


class MarketConfig(AppConfig):
    name = "market"
    verbose_name = "السوق"

    def ready(self) -> None:
        from market import providers  # noqa: F401
