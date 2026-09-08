# Foundry upload gateway — production image.
#
# Single-stage: Pillow ships manylinux wheels for this platform, so no
# compiler is needed to build the dependency closure.
#
# requirements.txt is the full pinned dependency closure (direct + transitive)
# — see server/README.md for how to regenerate it. Installing from it first,
# then the app with --no-deps, keeps that (expensive, rarely-changing) layer
# cached across builds where only app/ changed.
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --no-deps .

# No shell, no home directory — matches the `foundry` system user this
# replaced on the VM.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin gateway
USER gateway

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import urllib.request as u,sys; sys.exit(0 if u.urlopen('http://127.0.0.1:8000/health',timeout=2).status==200 else 1)"

COPY gunicorn.conf.py ./
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app.main:app"]
