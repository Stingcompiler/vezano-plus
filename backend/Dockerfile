# خادم فيزانو بلص (Django) — للنشر على خادم خاص (deploy/ovh؛ 0005 §١٤٠)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

# عميل PostgreSQL 16 للنسخ الليلي (pg_dump يطابق إصدار الخادم)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev && chmod +x deploy/*.sh

# قاعدة الدولة لتحليلات الزوار (0005 §٢١٩): DB-IP Lite (CC BY 4.0) تتجدّد مع كل نشر — هذا الشهر، وإلا
# السابق (أول الشهر قبل صدوره). تعذّر التنزيل لا يكسر البناء: الدولة تصير «غير معروفة» فقط
RUN mkdir -p /app/geo && for m in "$(date -u +%Y-%m)" "$(date -u -d '-1 month' +%Y-%m)"; do \
      curl -fsSL --max-time 120 -o /tmp/geo.gz "https://download.db-ip.com/free/dbip-country-lite-$m.mmdb.gz" \
      && gunzip -c /tmp/geo.gz > /app/geo/dbip-country-lite.mmdb && break; \
      rm -f /app/geo/dbip-country-lite.mmdb; \
    done; rm -f /tmp/geo.gz; ls -l /app/geo

RUN useradd --system --create-home --uid 10001 app && mkdir -p /app/private-app-releases /backups && chown -R app /app /backups
USER app
# `uv run --no-sync` وقت التشغيل بلا ذاكرة مؤقتة (المستخدم بلا صلاحية كتابة خارج بيته)
ENV UV_NO_CACHE=1
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "gunicorn", "sting.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "60"]
