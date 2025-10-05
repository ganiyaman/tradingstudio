# Dockerfile (repo kökü) — HF Spaces Docker backend
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860

WORKDIR /app

# Python bağımlılıkları
COPY requirements.txt .
RUN python -m pip install --upgrade pip setuptools wheel && \
    pip install --prefer-binary -r requirements.txt

# FastAPI uygulaması (optimizer_api.py kökte)
COPY optimizer_api.py .

EXPOSE 7860
CMD ["bash","-lc","uvicorn optimizer_api:app --host 0.0.0.0 --port ${PORT:-7860}"]
