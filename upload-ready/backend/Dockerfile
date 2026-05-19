FROM python:3.14-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    iproute2 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install docker CLI
RUN curl -fsSL https://get.docker.com | sh

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:9001/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
