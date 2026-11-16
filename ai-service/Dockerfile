FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    AI_TORCH_THREADS=1 \
    AI_MAX_INFERENCE_SIDE=960 \
    AI_INFERENCE_MIN_INTERVAL_SECONDS=1 \
    AI_INFERENCE_TIMEOUT_SECONDS=10 \
    YOLO_MODEL_PATH=/app/models/yolo11n.pt

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY main.py .
COPY models ./models
COPY assistant ./assistant

EXPOSE 8000

CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]

